# wool trusted config files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing from a repo's `wool.yml(.dist)` runs until the person has trusted its exact contents (decline / trust once / trust project), with `wool.sh list|forget|run` to undo and retry.

**Architecture:** Trust logic lives in one POSIX script, `mods/wool/bin/wool.sh` (store, checksum, gitignore check, the interactive prompt, re-run requests), tested from Node like the other scripts. main.js gains a gate between "config is valid" and "run it", a `wool` prompt tab polled through a state file, and a watcher on `~/.config/wool/requests/`. Small pure helpers in `mods/wool/lib/trust.js` parse what the script prints.

**Tech Stack:** Herdr app mod (gpui-kit JS runtime), POSIX `sh`, Node 22 `node --test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-wool-trust-design.md`

## Global Constraints

- Work in `~/.herdr/worktrees/wool/feat-trust` on branch `feat/trust`. One commit per task; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` (`node --test tests/*.test.js`) passes after every task.
- Never edit Herdr's shipped mods or layouts in `~/.config/herdr-app`. `herdr-app check` must pass on the mod after every change to `mods/wool/`.
- Scripts are POSIX `sh` (the `scripts are valid POSIX sh` test in `tests/shell.test.js` must cover `wool.sh`). Programs used: `git`, `sh`, `shasum -a 256` (fall back to `sha256sum`), `mkdir`, `mv`, `rm`, `tr`, `date`, `awk`/`sed`/`grep`.
- Store: `${XDG_CONFIG_HOME:-$HOME/.config}/wool/trust.tsv`, lines `<sha256>\t<trusted|declined>\t<repo main checkout>\t<file>\t<ISO date>`; key repo + sha; a new decision for the same key replaces the old line; writes are atomic (temp file in the same folder + `mv`) under a `mkdir` lock.
- Requests: `${XDG_CONFIG_HOME:-$HOME/.config}/wool/requests/`, one file per request, content = the worktree's top folder.
- `wool.sh` has **no `trust` subcommand**. Unknown subcommand → usage on stderr, exit 2.
- Gate: a gitignored `wool.yml` is trusted implicitly; a non-ignored `wool.yml` and any `wool.yml.dist` are gated. Invalid files never prompt. No prompt when the space would run nothing (gate sits after the `!hasSetup && !layout` return).
- Nothing from an untrusted file runs before the answer: no setup, no pane, no agent, no background command.
- Live tests: quiz at `~/Code/github.com/svenluijten/quiz` (its uncommitted `.herdr/wool.yml.dist`); remove test worktrees afterwards; commit nothing to quiz. To run this branch live, re-point `~/.config/herdr-app/mods/wool` at the worktree's `mods/wool`, restart wool (`herdr-app do mod.open --name wool` toggles; check `herdr-app status` lists `"wool"` under overlays), and point it back at `~/Code/github.com/svenluijten/wool/mods/wool` afterwards. Tests must set `XDG_CONFIG_HOME` to a temp dir: never touch the real store from tests.

## Review Focus

1. Two prompts answering at once (two worktrees made together) both land in the store: one line each, nothing lost (test in Task 1).
2. A file containing terminal escape sequences (`\033]...`, `\r`) can't rewrite what the prompt shows: control characters other than newline and tab are stripped when printing (test in Task 2).
3. The prompt's terminal is closed / Ctrl-C'd: `trust-answer` is `none`, nothing in the store (test in Task 2).
4. `wool.sh run` on a worktree whose setup is `running`: refused, state left alone (test in Task 3).
5. A store with blank, malformed or foreign lines (hand-edited): ignored, never crashes `check`/`list`, and survives a rewrite (test in Task 1).

---

### Task 1: Trust store and gate check in `wool.sh`

**Files:**
- Create: `mods/wool/bin/wool.sh`, `mods/wool/lib/trust.js`, `tests/trust.test.js`
- Modify: `mods/wool/lib/config.js` (return the text read), `tests/config.test.js`, `tests/shell.test.js` (POSIX check covers `wool.sh`)

**Interfaces:**
- Produces:
  - `loadConfig(roots, read)` → `{ file, text, value, error }` (`text`: the exact string read, `null` when no file).
  - `wool.sh check <state dir> <repo> <file>`: checksums `<state dir>/config.yml`, writes `<state dir>/trust-request` (`<repo>\t<file>\t<sha>\n`), prints one line `<implicit|trusted|declined|ask>\t<sha>`, exit 0. `implicit` when basename is `wool.yml` and `git -C "$(dirname file)" check-ignore -q file` succeeds.
  - `wool.sh list` (stdout lines `<decision>  <short sha 12>  <repo>  <file>  <date>`, or `No trusted or declined files.`), `wool.sh forget <folder>` (removes all lines whose repo is the main checkout of `<folder>`'s repo; prints `Forgot <n> entr(y|ies) for <repo>.`; not a repo → stderr, exit 1).
  - Internal shell function `store_put <sha> <decision> <repo> <file>` used by Task 2.
  - `lib/trust.js`: `parseCheck(stdout: string): { verdict: "implicit"|"trusted"|"declined"|"ask", sha: string } | null`.

- [x] **Step 1: Write the failing tests** in `tests/trust.test.js` (each with its own `XDG_CONFIG_HOME` temp dir and a temp git repo + linked worktree, built like `tests/detect.test.js`'s claim fixtures):
  - `check: a dist with no entry asks` → stdout `ask\t<sha>` where sha equals `shasum -a 256` of `config.yml`; `trust-request` is `<repo>\t<file>\t<sha>\n`.
  - `check: a gitignored wool.yml is implicit` (repo `.gitignore` has `.herdr/*.yml`).
  - `check: a wool.yml that isn't ignored asks`.
  - `check: a trusted entry for this repo and sha is trusted`; `check: same sha, other repo asks`; `check: a declined entry is declined`; `check: a changed file (new sha) asks again`.
  - `store: two concurrent puts both land` (spawn 10 `store_put`s at once via `sh -c '. wool.sh; store_put …'`-style entry point — expose as hidden subcommand `wool.sh _put` for tests only, not in usage) → 10 lines.
  - `store: a new decision replaces the old line for the same repo and sha`.
  - `store: junk lines are kept and ignored` (blank line, `garbage`, 3-field line) → `check` still works, `list` shows only valid entries, a `_put` keeps the junk lines.
  - `list: empty store says so`; `list: shows decision, short sha, repo, file`.
  - `forget: removes every entry for the repo, from a worktree path too` → message `Forgot 2 entries for <repo>.`; other repos' lines stay.
  - `wool.sh: no trust subcommand` → `wool.sh trust x` exits 2, usage on stderr, store untouched.
  - `parseCheck` unit cases: valid line, trailing newline, unknown verdict → null, empty → null.
  - In `tests/config.test.js`: `loadConfig returns the text it read` (`c.text === CONFIG`), and `text: null` in the no-file case.
- [x] **Step 2: Run** `node --test tests/trust.test.js tests/config.test.js` — Expected: FAIL (`wool.sh` missing, `parseCheck` not exported, `text` undefined).
- [x] **Step 3: Implement** `wool.sh` (`check`, `list`, `forget`, `_put`, usage), `parseCheck` in `lib/trust.js`, and `text` in `loadConfig`. Lock: `mkdir "$dir/trust.lock"` retried every 0.1 s for up to 5 s, removed by trap; then read → filter out the key → append → write `trust.tsv.$$` → `mv`. A valid line has exactly 5 tab-separated fields, a 64-hex sha, and decision `trusted`/`declined`. Main checkout resolution as in `wool-claim.sh` (`--git-common-dir`, strip `/.git`, else `git worktree list --porcelain` first line).
- [x] **Step 4: Run** `npm test` — Expected: all pass.
- [x] **Step 5: Commit** `feat: trust store and gate check (wool.sh check/list/forget)`.

### Task 2: The interactive prompt

**Files:**
- Modify: `mods/wool/bin/wool.sh` (`prompt`), `tests/trust.test.js`

**Interfaces:**
- Consumes: `store_put`, `<state dir>/trust-request`, `<state dir>/config.yml` (Task 1).
- Produces: `wool.sh prompt <state dir>` writes `<state dir>/trust-answer` = `trust` | `once` | `decline` | `none` (one word + newline); `trust`/`decline` also `store_put`. Exits 0 after an answer, 1 when stdin isn't a terminal (prints `wool.sh prompt: needs a terminal` to stderr, writes nothing), 130 on interrupt.

- [ ] **Step 1: Write the failing tests** — run the prompt under a pseudo-terminal with `script -q /dev/null sh wool.sh prompt <dir>` (BSD/macOS `script`; skip the pty tests when `script` isn't BSD-style) feeding stdin:
  - `prompt: shows repo, file, sha and contents` (stdout contains each, and the file's lines).
  - `prompt: t trusts the project` → answer `trust`, store has `trusted` line; `prompt: o trusts once` → `once`, store empty; `prompt: d declines` → `decline`, store has `declined` line.
  - `prompt: anything else asks again` (input `x\nt`) → `trust`, and the question printed twice.
  - `prompt: control characters in the file are stripped` (config contains `\033]0;evil\007` and `\r`) → stdout has no `\033`, `\007`, `\r` from the file.
  - `prompt: hang-up writes none` (start it, send SIGHUP) → `none`, store empty.
  - `prompt: refuses without a terminal` (`spawnSync` with piped stdin) → exit 1, no `trust-answer`.
  - After `trust`/`once`: stdout mentions `wool.sh run`; after `decline`: mentions `wool.sh forget` and `wool.sh run`.
- [ ] **Step 2: Run** `node --test tests/trust.test.js` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** `prompt`: `[ -t 0 ]` check; trap HUP/INT/TERM → write `none`, exit 130; print header, then `LC_ALL=C tr -d '\000-\010\013-\037\177' < config.yml` (keeps `\t` `\n`); loop `printf '[d]ecline  trust [o]nce  [t]rust project: '; read -r a` (case-insensitive first letter); EOF on read = `none`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: wool.sh prompt asks before running a repo's config`.

### Task 3: Gate in main.js

**Files:**
- Modify: `mods/wool/main.js` (`prepare`, new `askTrust`), `mods/wool/lib/trust.js`, `tests/trust.test.js`

**Interfaces:**
- Consumes: `loadConfig().text`, `wool.sh check`, `wool.sh prompt`, `parseCheck` (Tasks 1–2).
- Produces:
  - `lib/trust.js`: `readAnswer(text: string | null): "trust"|"once"|"decline"|"none"|null` (null while not answered / unknown word); `promptTab(binDir, stateDir): { name: "wool", argv: ["sh", `${binDir}/wool.sh`, "prompt", stateDir] }`.
  - main.js `askTrust(cx, space, kind, wt, file): Promise<boolean>` (true = go on).

- [ ] **Step 1: Write the failing tests** for `readAnswer` (each word, with trailing newline, `null`, `""`, `"maybe"`) and `promptTab` (exact argv).
- [ ] **Step 2: Run** `node --test tests/trust.test.js` — Expected: FAIL (not exported).
- [ ] **Step 3: Implement** the helpers, then in `prepare()`, after the `if (!hasSetup && !layout) return;` line and before `setup.sh` is written:
  1. write `config.text` to `${wt.stateDir}/config.yml` (same `exec printf` way as `setup.sh`);
  2. `exec("sh", [wool.sh, "check", stateDir, wt.main, config.file])` → `parseCheck`; failure → throw (the existing "stopped" notification);
  3. `implicit`/`trusted` → go on; `declined` → return silently; `ask` → `askTrust`.
  `askTrust`: `run("tab.new", { space, name: "wool", folder: wt.worktree, argv })`, find the new tab/pane by diffing (as `execute` does). `kind === "plain-shell"`: leave focus on it. Otherwise: give focus back to what had it (`focused()` before), and `notify({ title: "wool: trust needed for <repo basename>", body: "Answer in the wool tab of <branch>.", level: "warning", action: { name: "pane.focus", args: { pane } } })`. Poll `trust-answer` every 500 ms with `readAnswer` until non-null (no timeout). Then `run("tab.close", { id: tab, confirmed: true })`. `trust`/`once` → true. `decline` → info notify `wool: skipped <branch>` / `You declined .herdr/<file> for <repo>.`; `none` → info notify `wool: skipped <branch>` / `No answer. To ask again: sh "<bin>/wool.sh" run "<worktree>"`; both → false.
  Change the "stopped" notification's retry line to `To try again: sh "<bin>/wool.sh" run "<worktree>"`.
- [ ] **Step 4: Run** `npm test` and `herdr-app check ~/.herdr/worktrees/wool/feat-trust/mods/wool` — Expected: all pass, `check passed`.
- [ ] **Step 5: Commit** `feat: ask before running an untrusted wool.yml`.

### Task 4: `wool.sh run` and re-run requests

**Files:**
- Modify: `mods/wool/bin/wool.sh` (`run`), `mods/wool/bin/wool-claim.sh` (`rerun` mode), `mods/wool/main.js` (request watcher), `mods/wool/lib/trust.js`, `tests/trust.test.js`, `tests/detect.test.js`

**Interfaces:**
- Produces:
  - `wool.sh run <folder>`: linked worktree only (else stderr `wool.sh run: <folder> isn't a linked git worktree`, exit 1); writes `requests/<epoch>-<pid>` atomically (temp + `mv`) containing the worktree top + `\n`; prints `Asked wool to set up <top>.`
  - `wool-claim.sh <folder> rerun`: no freshness check; if `<git-dir>/wool/status` first line is `running` → prints `running`; else `rm -rf <git-dir>/wool` and claims as usual (prints the `claimed…` line).
  - `lib/trust.js`: `spaceForFolder(spaces, folder): Space | null` (local spaces only: `machine` null/undefined; match `space.folder === folder` after stripping one trailing `/`).
  - main.js `watchRequests(cx)` started once when `known` is first seeded; handles files already present, then loops on `watchFolder(dir)` with a 5 s timer fallback.

- [ ] **Step 1: Write the failing tests:**
  - `run: writes a request with the worktree top` (from a subfolder of the worktree), `run: refuses the main checkout`, `run: refuses a non-repo folder`.
  - `wool-claim rerun: claims a stale worktree`, `wool-claim rerun: clears old state and claims again` (state dir with `status` `failed x` and a `config.yml` → gone, re-created empty), `wool-claim rerun: refuses while setup is running` → `running`, state untouched.
  - `spaceForFolder`: match, trailing slash, remote skipped, none → null.
- [ ] **Step 2: Run** `node --test tests/trust.test.js tests/detect.test.js` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** In main.js, each request: read it, delete it, `spaceForFolder(spaces(), top)`; none → warning `wool: no open space for <~folder>` / `Open the worktree in Herdr, then run wool.sh run again.`; else claim with `wool-claim.sh <top> rerun` (`running` → info `wool: setup is already running in <branch>`), classify with `classifySpace(space, panes(), terminals(), now - PENDING_LIMIT_MS, now)` (so it never stays pending), add the space to `known`, and continue into `prepare()` exactly as `handle()` does after its claim (factor the shared part out of `handle` rather than duplicating it). The requests dir comes from `exec sh -c 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}/wool/requests"'` and is created with `mkdir -p`.
- [ ] **Step 4: Run** `npm test` and `herdr-app check …/feat-trust/mods/wool` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: wool.sh run sets up an existing worktree again`.

### Task 5: Docs and live acceptance

**Files:**
- Modify: `README.md`, `RECIPE.md`
- Create: `docs/notes/trust-acceptance.md`

- [ ] **Step 1: README** — new "Trust" section (the three answers; what's gated; gitignored `wool.yml` is trusted; a changed file asks again; `wool.sh list` / `forget` / `run` with full `sh ~/.config/herdr-app/mods/wool/bin/wool.sh …` commands; the store path; agents may use `list`/`forget`/`run`, and there is deliberately no `trust` command; the plain warning that this stops the easy path, not a determined process running as you). Update "Security and trust", "Errors and failures" (retry is `wool.sh run`), "What you see"/"How it behaves"/"Done when" in RECIPE.
- [ ] **Step 2: Live acceptance** (symlink switched to this worktree, wool restarted, `XDG` left as the real one; back up `~/.config/wool/trust.tsv` first if it exists and restore it after). Record each result in `docs/notes/trust-acceptance.md`:
  1. New quiz worktree, no entry → `wool` tab with the file; nothing else runs (no Server, no agent) while it waits.
  2. `t` → prompt tab closes, layout + setup as before; `wool.sh list` shows `trusted`.
  3. Another new worktree → no prompt, runs directly.
  4. Edit quiz's `.dist` (append a comment) → next worktree asks again; `o` runs, store unchanged.
  5. `d` → space stays as it arrived, info notification; next worktree with the same file → nothing, no prompt.
  6. `wool.sh forget ~/Code/github.com/svenluijten/quiz` then `wool.sh run <that worktree>` → prompt appears again.
  7. Personal gitignored `wool.yml` in quiz main (if quiz's `.gitignore` doesn't ignore it, say so and test with `.git/info/exclude`) → no prompt.
  8. Close the prompt tab without answering → `none` notification with the `wool.sh run` hint.
- [ ] **Step 3: Clean up** — remove test worktrees/branches, restore quiz's `.dist`, remove any personal `wool.yml`, restore the trust store, point the symlink back at the main checkout, restart wool, `herdr-app status` shows `"wool"`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `docs: trust in README and RECIPE, acceptance notes`.
