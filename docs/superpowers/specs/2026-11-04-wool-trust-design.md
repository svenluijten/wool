# wool: trusted config files

Status: design, approved in conversation 2026-11-04. Builds on
`2026-11-04-wool-design.md` and the single-file config (`.herdr/wool.yml(.dist)`,
commit 5dc8149).

## Why

A repo's committed `.herdr/wool.yml.dist` runs commands as you the moment you
make a worktree: setup steps, pane commands, background commands, the agent
panes. Today wool runs whatever the file says. Clone a repo you don't fully
trust, make a worktree, and its commands have already run.

The gate: nothing from a config file that someone else could have written runs
until you've said yes to **its exact contents**. Once you trust a file, wool
works as it does today, without asking again, until the file changes.

## Goals

- First new worktree in a repo with an untrusted config: ask before anything
  from the file runs.
- Three answers:
  - **Decline**: wool does nothing for this worktree, and never asks again
    about *this exact file*. A changed file asks again.
  - **Trust once**: wool runs as today for this worktree. Nothing is saved;
    the next worktree asks again.
  - **Trust project**: wool runs as today, and the file's checksum is saved
    as trusted. Later worktrees with the same file content run without asking.
- A file that changes (a pull brings a new `.dist`, a branch edits it) has a new
  checksum, so the next worktree asks again.
- A **gitignored** personal `wool.yml` is trusted implicitly: you wrote it.
- A **non-gitignored** `wool.yml` (committed, or untracked but not ignored) goes
  through the gate like a `.dist`.
- Undo from a terminal: `wool.sh list` and `wool.sh forget <repo>`.
- Re-run wool on an existing worktree: `wool.sh run <folder>` (goes through
  the gate like a new worktree).

## Non-goals

- Showing a diff against the previously trusted version (the prompt shows the
  whole file).
- Trusting from the command line. `wool.sh` has no `trust` subcommand, on
  purpose: an agent told to "run wool.sh trust" (by a README, a task, a
  malicious repo) must not be able to. Agents may use `list` and `forget`.
- Signing, per-user allowlists of authors, or anything network-based.
- Trust for remote spaces (wool skips them already).

## Anti-goals

- Anything from an untrusted file running before the answer: no setup step,
  no pane command, **no agent pane**, no background command, no layout change
  beyond the prompt tab itself.
- Running content other than what was shown and checksummed (a file edited
  between the prompt and the run must not slip through).
- Claiming more security than this gives. The `trust`-less CLI is a speed bump,
  not a lock: anything running as you can write wool's trust file or type
  into the prompt's pane. The README says so plainly.

## Constraints

- Everything in the original design still holds: wool is an invisible kept
  overlay; long work runs in terminals via POSIX `sh` scripts in
  `mods/wool/bin/` (exec has a 30 s limit); no dependencies; pure logic in
  `mods/wool/lib/` tested with `node --test`; `herdr-app check` passes after
  every change.
- Never edit Herdr's shipped mods or layouts in `~/.config/herdr-app`.
- `~/.config/herdr-app/mods/wool` is a symlink to the **main** checkout's
  `mods/wool`. To try this branch live, point it at this worktree for the
  test and point it back afterwards (and restart wool: hot reload doesn't
  follow the symlink; `herdr-app do mod.open --name wool` toggles).
- Live tests use `~/Code/github.com/svenluijten/quiz` (its uncommitted
  `.herdr/wool.yml.dist`); remove test worktrees afterwards; commit nothing
  to quiz.
- Work happens on branch `feat/trust` in `~/.herdr/worktrees/wool/feat-trust`.

## Decided

### Which file is gated

wool already resolves one file (first match wins): main `wool.yml`, worktree
`wool.yml`, worktree `wool.yml.dist`, main `wool.yml.dist`. The gate applies
to that resolved file:

| Resolved file | Gate |
|---|---|
| a `wool.yml` that git ignores (`git check-ignore` in the checkout it's in) | none, trusted implicitly |
| a `wool.yml` that git does not ignore | gated |
| any `wool.yml.dist` | gated |

**Only when something would run.** The gate sits after `prepare()`'s existing
"nothing to do" check: if this space would run nothing from the file (no
setup steps, and the space isn't a plain shell so no layout), there is no
prompt and nothing is recorded. *(Builder-check call: asking about a file that
won't run here is noise; it's asked at the next worktree where it would.)*

An **invalid** file (YAML or schema error) never prompts: the existing
"`.herdr/wool.yml…` is invalid" notification, and nothing else.

### The checksum

SHA-256 of the exact bytes wool read and will run. wool reads the file once,
writes that text to the worktree's state dir (`<git-dir>/wool/config.yml`),
checksums that copy, shows that copy in the prompt, and runs what it parsed
from that same text. A file edited after the read changes nothing for this
worktree.

### The trust store

One file of wool's own, outside the mod folder so reinstalling wool keeps it:
`${XDG_CONFIG_HOME:-$HOME/.config}/wool/trust.tsv`. One line per decision:

```
<sha256>\t<trusted|declined>\t<repo main checkout, absolute>\t<file path as resolved>\t<ISO date>
```

- The key is **repo + checksum**. A repo can have several entries (older
  branches carry older `.dist` versions; they shouldn't ping-pong).
- A new decision for the same repo + checksum replaces the old line.
- Lookup for a worktree: an entry for this repo with this checksum →
  `trusted` runs without asking, `declined` does nothing (silently: no prompt,
  no notification). No entry → ask.
- "Trust once" writes nothing.
- Missing file or folder = nothing trusted. Writes are atomic (write a temp
  file in the same folder, then `mv`).

### The prompt

After the claim and a valid config, when the file is gated and has no
entry, wool adds **one tab named `wool`** to the new space instead of doing
anything else. Its terminal runs `sh <bin>/wool.sh prompt <state dir>`, which:

1. Prints which repo and file this is, the checksum, and the file's
   contents (from `<state dir>/config.yml`).
2. Asks: `[d]ecline  trust [o]nce  [t]rust project`. Reads one answer from
   the terminal; anything else asks again.
3. Writes the answer to `<state dir>/trust-answer` (`decline`, `once` or
   `trust`) and, for `decline` and `trust`, the store line.
4. After `trust` or `once`, prints that wool is setting up the worktree, and
   that if nothing happens (wool restarted while the prompt was open) to run
   `sh <bin>/wool.sh run <worktree>`. After `decline`, prints how to undo it
   (`wool.sh forget`, then `wool.sh run`).
5. Exits.

If the terminal closes or Ctrl-C ends the prompt without an answer, nothing
is saved and nothing runs for this worktree (treated like a decline that
isn't remembered); `<state dir>/trust-answer` gets `none`.

`wool.sh prompt` refuses to run when stdin isn't a terminal.

wool (main.js) waits for `trust-answer` by polling it, as it polls `status`
today. Then:

- `trust` or `once`: close the `wool` tab and carry on exactly as today
  (layout + setup for a plain-shell space, a Setup tab otherwise).
- `decline` or `none`: close the `wool` tab, post an info notification
  ("wool: skipped <branch>" / "You declined .herdr/<file> for <repo>." or
  "No answer…"), leave the space as it arrived.

Focus and notice:

- A **plain-shell** space (the one wool lays out): the `wool` tab takes focus
  (the space just appeared; you're looking at it).
- **Any other** space (e.g. a briefed agent): the `wool` tab doesn't take
  focus (as the Setup tab today), and a warning notification "wool: trust
  needed for <repo>" has a click action that focuses the prompt pane.

While the prompt waits, the space's original tab stays as it arrived and
usable. The agent from the layout does **not** start until you trust.

### `wool.sh`

`mods/wool/bin/wool.sh`, POSIX `sh`:

- `wool.sh list`: every store entry, readable (decision, repo, file, date,
  short checksum). Empty store: says so.
- `wool.sh forget <folder>`: removes every entry for the repo that `<folder>`
  belongs to (any checkout of it: resolve the main checkout through git), and
  says how many. Next worktree asks again.
- `wool.sh run <folder>`: re-runs wool for the worktree `<folder>` belongs to
  (see below). Says the request was sent.
- `wool.sh prompt <state dir>`: the interactive prompt above (wool runs it;
  you normally don't).
- No `trust` subcommand. Unknown subcommand: usage on stderr, exit 2.

### Re-running: `wool.sh run`

The claim (`mkdir <git-dir>/wool`) is taken before the prompt, and `setup.sh`
is written only after trust, so a worktree whose prompt ended without trust
(declined, prompt closed, or wool restarted while it was open) would otherwise
never be set up. `wool.sh run` is the one way back for all three; wool does
**not** reconnect to prompts that were open when it restarted.

- `wool.sh run <folder>` resolves the worktree (linked worktree only; the
  main checkout or a non-repo folder is an error on stderr, exit 1) and writes
  a request file into `${XDG_CONFIG_HOME:-$HOME/.config}/wool/requests/`
  naming the worktree's top folder.
- main.js watches that folder (`watchFolder`, with a timer fallback) from
  start-up. For each request: delete the file; find the open, local space
  whose folder is that worktree (none → warning notification "wool: no open
  space for <folder>"); remove the worktree's `<git-dir>/wool` state (unless
  setup is `running` there now: then info notification and nothing else);
  then claim and handle that space exactly as a new one, **without the
  3-minute freshness check**. Classification is as today: a space that is
  still one plain shell is laid out; any other gets setup in a Setup tab.
- The gate applies as for a new worktree: `run` never trusts anything. That's
  why agents may use it.
- Requests that arrive while wool isn't running are picked up when it starts.

### Docs

README: a "Trust" section (the three answers, what's gated, gitignored
`wool.yml` is trusted, changes ask again, `wool.sh list` / `forget` / `run`, where the
store lives, and the plain warning that this stops the easy path, not a
determined process running as you). Update "Security and trust", "Errors and
failures" and RECIPE to match.

## Left to the builder

- How the checksum is computed (`shasum -a 256` via exec is fine; the Herdr
  JS runtime may not have crypto).
- How main.js finds the `wool` tab's pane for the notification action and to
  close it (diffing, as today).
- The exact wording of prompt text and notifications, within the above.
- Where the trust logic lives in `lib/` (a pure module for the gate decision
  and store parsing is expected) and how it's tested; shell behaviour tested
  the way `tests/shell.test.js` tests the other scripts.
- Whether `wool-run.sh` by hand (the existing retry command) needs a guard:
  it runs `setup.sh`, which wool only writes after trust, so probably not.
  The "stopped" notification's retry hint may point at `wool.sh run` instead.
- Concurrency of two prompts writing the store at once (lock or
  read-modify-`mv` retry), and escaping terminal control characters when the
  prompt prints the file.
