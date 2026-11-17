# wool

A mod for the [Herdr](https://herdr.dev) app that gets a new git worktree
ready to work in. When a worktree space shows up, wool runs the repo's setup
steps (copy `.env`, install dependencies, …) in a terminal you can watch, and
lays out the space's tabs: your agent, a shell, a dev server that starts once
setup has succeeded. Both are described by files committed to the repo, with
personal overrides.

![wool](preview.png)

- Setup runs **once**, for any new worktree space, however it was made.
- The agent tab opens **immediately** and has the keyboard while setup runs.
- Commands that need setup (a dev server) wait for it, and don't start if it
  fails. A failure stays on screen and posts a notification.
- Spaces that arrive with something already in them (a briefed agent) are
  never rearranged: wool only adds a "Setup" tab behind them.

## Installation

wool runs programs and reads files outside its own folder: it runs `git`,
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

   wool runs as an invisible window (it draws nothing). Herdr keeps it and
   reopens it every time the app starts, so there is no layout to edit and the
   shipped `main` layout stays as it is.

Good to know:

- **Per layout.** Herdr keeps windows per layout. If you switch to another
  layout (`ctrl-shift-l`), run `herdr-app do mod.open --name wool` there too.
- **`mod.open` toggles.** Running it again closes wool. That's also how to
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
becomes `composer run dev`. A notification says "wool: &lt;branch&gt; is ready".

## Configuration

One file in the repo's `.herdr/` folder:

| Committed (shared) | Personal override (gitignored) |
|---|---|
| `.herdr/wool.yml.dist` | `.herdr/wool.yml` |

- A plain `wool.yml` **replaces the `.dist` entirely**. Nothing is merged.
- `setup` and `tabs` are both optional, but the file needs at least one:
  setup without tabs is fine (it runs in an added "Setup" tab), and so is the
  reverse. With no file, wool does nothing for that repo.
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
| `background[]` | *wool.* Commands with no pane (needs `tabs`): `command`, optional `env` and `waitForSetup`. Output goes to `<worktree git dir>/wool/bg-<n>.log`, the pid to `bg-<n>.pid` (kill it to stop the command), the exit code to `bg-<n>.exit`. A nonzero exit posts a notification while wool keeps running; after a reload or an app restart wool stops watching, but the files stay. Background commands keep running after `git worktree remove`: stop them first. |

A pane with neither `command` nor `agent` is a plain shell. Unknown fields,
`command` with `agent`, two `setup: true` panes, or `prompt` without `agent` are
errors.

The file has a JSON schema, [`schema/wool.schema.json`](schema/wool.schema.json),
for editors; add the `# yaml-language-server: $schema=…` line shown above.

### YAML

wool reads the YAML this file needs (maps, lists, strings, numbers,
`true`/`false`, comments, `[]`, `{}`) and rejects the rest with a line number:
tab indentation, `|`/`>` block scalars, anchors and aliases, flow lists with
items, more than one document. Quote a value that contains `: ` or ` #`.

## Which spaces get what

wool acts on a space only when its folder is a **linked** git worktree, made
**in the last 3 minutes**, that wool hasn't handled before. Spaces that exist
when wool starts or reloads are never handled, and neither is the main
checkout or an old worktree you open again.

| A new space for a fresh worktree… | Setup | Layout |
|---|---|---|
| arriving as one tab with a plain shell (New worktree, Open worktree) | yes | yes, from `tabs` |
| arriving any other way (a briefed agent from a script, the worktree mod's `{branch, tab, argv}` form) | yes, in an added "Setup" tab that doesn't take focus | no: wool never closes, replaces or reorders tabs, and never starts a second agent |

With no `tabs`, setup runs in an added "Setup" tab that doesn't take
focus. Remote spaces (on another machine) are skipped in this version.

A worktree you make with `git worktree add` in a terminal and then open with
Open worktree within 3 minutes counts as new. That's on purpose.

## Environment variables

Every setup step gets:

| Variable | Value |
|---|---|
| `HERDR_WORKTREE` | The new checkout (steps also run there). |
| `HERDR_MAIN_WORKTREE` | The repo's main checkout. |
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

wool keeps its per-worktree state in the worktree's private git dir
(`<repo>/.git/worktrees/<name>/wool/`): the claim, `setup.sh`, `status`,
background logs. It never shows in `git status` and goes away with
`git worktree remove`. Setup runs once per worktree. To run it again (this
also updates `status`, so waiting commands follow it), in any terminal:
`sh ~/.config/herdr-app/mods/wool/bin/wool-run.sh <that folder>`.
- **Something goes wrong after wool claimed the worktree** (before setup
  started): a notification says what, and gives that same command.
- **You typed into the new space's shell before wool laid it out:** if
  something is running there, wool keeps that tab and says so.

## Security and trust

**A repo's `.herdr/wool.yml.dist` runs commands as you** when you create a
worktree, with your environment and permissions. That's the same trust you
give `composer` scripts or npm `postinstall`: only use wool with
repos whose committed files you trust, and read `.herdr/` in a repo before
making worktrees of it.

wool itself runs programs (`git`, `sh`, the setup steps, the commands in
`wool.yml`) and reads files outside its own folder (`.herdr/` files in
your repos, its state in their git dirs). It doesn't use the network.

## Relationship to herdr-dog and the workspace manager

- [herdr-dog](https://github.com/nickspaargaren/herdr-dog) runs
  `.herdr/worktrees.yml` setup steps for the Herdr **TUI**. wool does the
  same job for the Herdr **app**, with its own file: the same step fields
  (`name`, `run`, `env`), but under a top-level `setup:` instead of
  `worktrees.setup`, next to the layout.
- [razajamil/herdr-plugin-workspace-manager](https://github.com/razajamil/herdr-plugin-workspace-manager)
  lays out TUI workspaces from a global config. wool borrows its layout
  vocabulary and reads the layout from the repo.

## Development

```sh
npm test                                    # logic tests, no Herdr needed (Node 22)
ln -s "$PWD/mods/wool" ~/.config/herdr-app/mods/wool
herdr-app check ~/.config/herdr-app/mods/wool
herdr-app do mod.open --name wool
```

All decisions live in `mods/wool/lib/` (YAML reading, validation, file lookup,
space detection, layout planning, script generation) and are tested with
`node --test`. `mods/wool/bin/` holds the POSIX `sh` scripts that run in
terminals. `main.js` is the glue. `docs/notes/herdr-facts.md` records the
Herdr behaviour wool relies on.

Herdr's hot reload doesn't follow a symlinked mod folder: after editing
through the link, run `herdr-app do mod.open --name wool` twice to restart it.

## License

[MIT](LICENSE)
