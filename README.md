# wool

A mod for the [Herdr](https://herdr.dev) app that allows you to hook into a worktree's "created" and "removed" events. 

When a worktree space is created, `wool` runs the repo's setup steps (copy `.env`, install dependencies, …) 
in a terminal you can watch, and lays out the space's tabs: your agent, a shell, a dev server that starts
once setup has succeeded. Both are described by declarative files committed to the repo, with an option for
personal overrides.

![wool](preview.png)

- Setup runs **once**, for any new worktree space, however it was made.
- The agent tab opens **immediately** and has the keyboard while setup runs.
- Commands that need setup (a dev server) wait for it, and don't start if it
  fails. A failure stays on screen and posts a notification.
- Spaces that arrive with something already in them (a briefed agent) are
  never rearranged: `wool` only adds a "Setup" tab behind them.
- Nothing from a repo's config runs until you've trusted **its exact
  contents**. See [Trust](#trust).

## Installation

`wool` runs programs and reads files outside its own folder: it runs `git`,
`sh` and your repo's setup commands, and reads `.herdr/` files in your repos.
See [Security and trust](#security-and-trust).

1. Copy (or link) [`mods/wool`](mods/wool) into `~/.config/herdr-app/mods/`:

   ```sh
   git clone https://github.com/svenluijten/wool ~/Code/wool
   cp -R ~/Code/wool/mods/wool ~/.config/herdr-app/mods/wool
   herdr-app check ~/.config/herdr-app/mods/wool
   ```

2. Start it, once:

   ```sh
   herdr-app do mod.open --name wool
   ```

   `wool` runs as an invisible window (it draws nothing). Herdr keeps it and
   reopens it every time the app starts, so there is no layout to edit and the
   shipped `main` layout stays as it is.

Good to know:

- **Per layout.** Herdr keeps windows per layout. If you switch to another
  layout, run `herdr-app do mod.open --name wool` there too.
- **`mod.open` toggles.** Running it again closes `wool`. That's also how to
  turn it off.
- `herdr-app status` lists `"wool"` under `overlays` while it runs.

## Quick start

In your repo, add `.herdr/wool.yml.dist` (this is
[`examples/laravel`](examples/laravel/.herdr/wool.yml.dist)):

```yaml
# .herdr/wool.yml.dist
version: 1

setup:
  - name: Copy .env
    run: cp "$HERDR_MAIN_WORKTREE/.env" .env
  - name: Install PHP dependencies
    run: composer install --no-interaction
  - name: Install JS dependencies
    run: npm ci

tabs:
  - title: Agent
    panes:
      - agent: default
  - title: Shell
    panes:
      - {}
  - title: Server
    panes:
      - command: composer run dev
        setup: true
```

Commit it. Now **New worktree** (the space menu or the + menu) gives a space
with three tabs: your agent (focused, ready to type into), a shell, and
Server, which shows `composer install` and `npm ci` scrolling by and then
becomes `composer run dev`.

## Configuration

One file in the repo's `.herdr/` folder:

| Committed (shared) | Personal override (gitignored) |
|---|---|
| `.herdr/wool.yml.dist` | `.herdr/wool.yml` |

- A plain `wool.yml` **replaces the `.dist` entirely**. Nothing is merged.
- `setup`, `tabs` and `teardown` are all optional, but the file needs at
  least one: setup without tabs is fine (it runs in an added "Setup" tab),
  and so is the reverse. With no file, `wool` does nothing for that repo.
- Add `.herdr/*.yml` to your `.gitignore` so personal files stay personal.

### Where the file is read from

First match wins:

1. `<main checkout>/.herdr/wool.yml` (your personal file; gitignored, so it
   normally only exists in the main checkout)
2. `<new worktree>/.herdr/wool.yml`
3. `<new worktree>/.herdr/wool.yml.dist` (so a branch that changes its
   `.dist` gets its own version, and your main checkout's uncommitted edits
   don't leak in)
4. `<main checkout>/.herdr/wool.yml.dist`

### Fields

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/svenluijten/wool/main/schema/wool.schema.json
version: 1
env:
  APP_ENV: local
setup:
  - run: cp "$HERDR_MAIN_WORKTREE/.env" .env
  - name: Install JS dependencies
    run: npm ci
    env:
      CI: "1"
tabs:
  - title: Agent
    panes:
      - agent: default
        prompt: Read CONTRIBUTING.md, then wait for my task.
  - title: Shell
    panes: 
      - {}
  - title: Dev
    panes:
      - command: npm run dev
        setup: true
      - command: npm run test -- --watch
        split: down
        waitForSetup: true
background:
  - command: npm run build:icons -- --watch
    waitForSetup: true
```

| Field | Meaning |
|---|---|
| `version` | `1`, required. |
| `env` | Environment for every setup step, pane and background command, under their own `env`. |
| `setup[]` | The setup steps, in order. The first step that exits nonzero stops setup. `[]` is valid (nothing to do). |
| `setup[].run` | Required. Run as `/bin/sh -c <run>` in the new worktree. |
| `setup[].name` | The label shown while it runs (default: the command). |
| `setup[].env` | Extra environment variables for this step. |
| `tabs[]` | The layout for a space that arrives as a plain shell: the tabs, in order (at least one). Leave it out for setup only. |
| `tabs[].title` | The tab's name (default: its number). |
| `tabs[].panes[]` | The panes (at least one). The first is the tab; each later one splits from the one before it. |
| `panes[].command` | A command, run with `sh -c` inside your login shell (so your `PATH`, not your aliases or shell functions). The shell stays when it exits, so a crash leaves its output on screen. |
| `panes[].agent` | An agent instead of a command. `default` (*wool*): your most-picked installed agent, from Herdr's `knownAgents()`. Or an agent's key (`claude`, `codex`, …) for personal files. Shared files never need to name one. |
| `panes[].prompt` | The agent's first message. Needs `agent`, and only works on a tab's first pane (a split can't be given one). |
| `panes[].env` | This pane's environment, over the top-level `env`. |
| `panes[].split` | `right` or `down` (also `vertical` = right, `horizontal` = down). Not on a tab's first pane. Default `right`. |
| `panes[].setup` | `true` on at most one pane: it shows setup's output, then runs its own `command` once setup succeeded (with no command it stays a shell). Not on an agent pane. Without one, setup runs in an added "Setup" tab. |
| `panes[].waitForSetup` | *wool.* The `command` waits for setup and doesn't run if setup fails. |
| `panes[].focus` | *wool.* The pane with the keyboard when the space opens (one at most). Default: the first agent pane, else the first pane. |
| `teardown[]` | *wool.* Steps run after the worktree is removed, same fields as `setup[]`. See [Teardown](#teardown). |
| `background[]` | *wool.* Commands with no pane (needs `tabs`): `command`, optional `env` and `waitForSetup`. Output goes to `<worktree git dir>/wool/bg-<n>.log`, the pid to `bg-<n>.pid` (kill it to stop the command), the exit code to `bg-<n>.exit`. A nonzero exit posts a notification while wool keeps running; after a reload or an app restart wool stops watching, but the files stay. Background commands keep running after `git worktree remove`: stop them first. |

A pane with neither `command` nor `agent` is a plain shell. Unknown fields,
`command` with `agent`, two `setup: true` panes, or `prompt` without `agent` are
errors.

The file has a JSON schema, [`schema/wool.schema.json`](schema/wool.schema.json),
for editors; add the `# yaml-language-server: $schema=…` line shown above.

### YAML

`wool` reads the YAML this file needs (maps, lists, strings, numbers,
`true`/`false`, comments, `[]`, `{}`) and rejects the rest with a line number:
tab indentation, `|`/`>` block scalars, anchors and aliases, flow lists with
items, more than one document. Quote a value that contains `: ` or ` #`.

## Which spaces get what

`wool` acts on a space only when its folder is a **linked** git worktree, made
**in the last 3 minutes**, that `wool` hasn't handled before. Spaces that exist
when `wool` starts or reloads are never handled, and neither is the main
checkout or an old worktree you open again.

| A new space for a fresh worktree… | Setup | Layout |
|---|---|---|
| arriving as one tab with a plain shell (New worktree, Open worktree) | yes | yes, from `tabs` |
| arriving any other way (a briefed agent from a script, the worktree mod's `{branch, tab, argv}` form) | yes, in an added "Setup" tab that doesn't take focus | no: wool never closes, replaces or reorders tabs, and never starts a second agent |

With no `tabs`, setup runs in an added "Setup" tab that doesn't take
focus. Remote spaces (on another machine) are skipped in this version.

A worktree you make with `git worktree add` in a terminal and then open with
"Open worktree" within 3 minutes counts as new. That's on purpose.

## Trust

A committed `.herdr/wool.yml.dist` runs commands as you. So the first time a
new worktree would run something from a file wool hasn't seen, wool runs
nothing and adds one tab, `wool`, that shows the repo, the file, its SHA-256
checksum and its full contents, and asks:

```
[d]ecline  trust [o]nce  [t]rust project:
```

- **Decline** (`d`): wool does nothing for this worktree, and won't ask about
  this exact file again (later worktrees with it get nothing, silently).
- **Trust once** (`o`): wool sets up this worktree as usual. Nothing is saved;
  the next worktree asks again.
- **Trust project** (`t`): wool sets up this worktree, and remembers the
  file's checksum for this repo. Later worktrees with the same file run
  without asking.

Until you answer, nothing from the file runs: no setup, no layout, no agent,
no background command, no teardown. The space's own tab stays usable. In a
plain-shell space the `wool` tab has the keyboard; in any other space (a
briefed agent) it doesn't, and a warning notification ("wool: trust needed for <repo>") takes
you there. Closing the tab or pressing Ctrl-C counts as no answer: nothing is
saved and nothing runs.

What's gated:

| The file wool uses | Asks? |
|---|---|
| a `wool.yml` that git ignores | no: you wrote it, it's trusted |
| a `wool.yml` that git doesn't ignore (committed, or not in `.gitignore`) | yes |
| any `wool.yml.dist` | yes |

A changed file (a pull brings a new `.dist`, a branch edits it) has a new
checksum, so the next worktree asks again. A repo can have several trusted
versions at once (older branches keep theirs). A space that would run nothing
from the file isn't asked about, and an invalid file is reported, never asked
about.

From a terminal:

```sh
sh ~/.config/herdr-app/mods/wool/bin/wool-trust.sh list               # every trusted and declined file
sh ~/.config/herdr-app/mods/wool/bin/wool-trust.sh forget <folder>    # forget every decision for <folder>'s repo
sh ~/.config/herdr-app/mods/wool/bin/wool-trust.sh run <folder>       # set up that worktree again (asks again if needed)
```

`run` is the way back after declining (`forget`, then `run`), after closing
the prompt without an answer, after wool restarted while a prompt was open,
or to re-run setup. It needs the worktree's space open in Herdr, and never
trusts anything by itself. There is deliberately **no `trust` command**:
trusting takes an answer typed into wool's prompt, so a README, a task or an
agent can't tell wool to trust something. Agents may use `list`, `forget` and
`run`.

Decisions are kept in `${XDG_CONFIG_HOME:-~/.config}/wool/trust.tsv`, one
line each: checksum, `trusted`/`declined`, repo (main checkout), file, date.
It's outside the mod folder, so reinstalling wool keeps it.

**This stops the easy path, not a determined attacker.** Anything already
running as you (a malicious `postinstall`, an agent) can edit that file or
type into the prompt's terminal. The gate makes sure you see a repo's
commands before they first run; it is not a sandbox.

## Teardown

`teardown` runs when a worktree wool set up is removed, for example to drop
the test database setup made:

```yaml
setup:
  - name: Create test database
    run: createdb "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"
teardown:
  - name: Drop test database
    run: dropdb --if-exists "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"
```

- **When.** A space wool set up closes, and within 10 minutes its folder is
  gone (Remove worktree closes the space first, then deletes the folder).
  A space you only close keeps its worktree, so nothing runs. When wool
  starts, it also tears down worktrees that were removed while it wasn't
  running (Herdr closed, or `git worktree remove` in a terminal), for every
  repo that has a space open.
- **Where.** In the main checkout, in the background. The worktree's files
  are gone by then, so teardown can't read its `.env`: work out names from
  `HERDR_BRANCH` the same way in setup and teardown.
- **Which steps.** The `teardown` from the file that was in force when setup
  ran, saved at that time. Editing the file later doesn't change the teardown
  of worktrees that already exist.
- **Afterwards.** A notification says whether it worked. wool saves the
  steps in `<repo>/.git/wool/<worktree name>/` (it outlives
  `git worktree remove`) and deletes that folder once teardown succeeds, and
  `<repo>/.git/wool/` too when it's empty. A failed teardown keeps the folder
  with `teardown.log`; the notification gives the command to run it again,
  and wool doesn't retry it by itself.

## Environment variables

Every setup and teardown step gets:

| Variable | Value |
|---|---|
| `HERDR_WORKTREE` | The new checkout (setup steps also run there; for teardown it no longer exists). |
| `HERDR_MAIN_WORKTREE` | The repo's main checkout (teardown steps run there). |
| `HERDR_BRANCH` | The new checkout's branch (empty when detached). |

## Examples

- [`examples/laravel`](examples/laravel/.herdr): `.env` from main,
  `composer install`, `npm ci`; Agent, Shell, Server (`composer run dev`).
- [`examples/node`](examples/node/.herdr): `npm ci`; Agent, Shell, Dev
  (`npm run dev`).
- [`examples/setup-only`](examples/setup-only/.herdr): setup only; the space
  keeps its tabs and gets a "Setup" tab.

## Errors and failures

- **A setup step fails:** setup stops there. The output and
  `wool: step '<name>' failed (exit N)` stay on screen, nothing waiting on
  setup starts, and a notification says which step failed (click it to go to
  the setup pane).
- **Setup is interrupted** (Ctrl-C in its pane, or its terminal closed): the
  running step is stopped, setup counts as failed (`interrupted`), and waiting
  commands give up. Quitting the Herdr app doesn't interrupt setup: terminals
  keep running in herdr-core, but the ready/failed notification is skipped.
- **The config file is broken:** a notification names the file and the
  problem (with the line for YAML errors), and wool does nothing else for
  that worktree.
- **No installed agent:** agent panes become plain shells, with a warning.
- **A teardown step fails:** see [Teardown](#teardown).

`wool` keeps its per-worktree state in the worktree's private git dir
(`<repo>/.git/worktrees/<name>/wool/`): the claim, `setup.sh`, `status`,
background logs, and the copy of the config it checksummed (`config.yml`).
It never shows in `git status` and goes away with `git worktree remove`.
Setup runs once per worktree. To run wool for it again (through the trust
gate, as for a new worktree), in any terminal:
`sh ~/.config/herdr-app/mods/wool/bin/wool-trust.sh run <that folder>`.
- **Something goes wrong after `wool` claimed the worktree** (before setup
  started): a notification says what, and gives that same command.
- **You declined, or closed the prompt:** an info notification says wool
  skipped the worktree. See [Trust](#trust) to undo it.
- **You typed into the new space's shell before `wool` laid it out:** if
  something is running there, `wool` keeps that tab and says so.

## Security and trust

**A repo's `.herdr/wool.yml.dist` runs commands as you** when you create a
worktree, with your environment and permissions. wool asks before a file it
hasn't seen runs (see [Trust](#trust)), but once you trust a file, it's the
same trust you give `composer` scripts or npm `postinstall`: read the file
before you answer `t`. `teardown` runs when you remove the worktree, from
the copy saved at setup.

`wool` itself runs programs (`git`, `sh`, the setup steps, the commands in
`wool.yml`) and reads files outside its own folder (`.herdr/` files in
your repos, its state in their git dirs, its trust store in
`~/.config/wool/`). The only thing it deletes is its own teardown record,
`<repo>/.git/wool/<name>/`, and `wool-teardown.sh` refuses any folder that
isn't one. It doesn't use the network.

## Development

```sh
npm test
ln -s "$PWD/mods/wool" ~/.config/herdr-app/mods/wool
herdr-app check ~/.config/herdr-app/mods/wool
herdr-app do mod.open --name wool
```

All decisions live in `mods/wool/lib/` (YAML reading, validation, file lookup,
space detection, layout planning, script generation) and are tested with
`node --test`. `mods/wool/bin/` holds the POSIX `sh` scripts that run in
terminals. `main.js` is the glue.

Herdr's hot reload doesn't follow a symlinked mod folder: after editing
through the link, run `herdr-app do mod.open --name wool` twice to restart it.
