# wool

Make a new git worktree and its space is ready to work in: your agent opens at
once with the keyboard, a shell tab sits next to it, and a Server tab shows the
repo's setup (`.env` copied, dependencies installed) scrolling by before it
becomes the dev server. What runs and which tabs appear come from
`.herdr/wool.yml.dist` committed in the repo (top-level `setup` steps and
`tabs`), with a personal `wool.yml` override. wool itself never shows.

![wool](preview.png)

## What you see

- **Nothing of wool itself.** It runs as a frameless, kept window overlay that
  renders an empty `div()`: no size, no frame, no clicks.
- **A laid-out space**, when a new worktree arrives as a single plain shell:
  exactly the tabs the file's `tabs` lists, in order, named by their
  `title`, with splits `right`/`down`. The space's original shell tab is
  closed. The first agent pane (or the `focus: true` one) has the keyboard.
- **Setup output in a terminal**: the pane marked `setup: true` (or an added
  tab named `Setup`) prints `==> <step name>` before each step, the steps' own
  output, then `wool: setup finished.` and the pane's command, or
  `wool: step '<name>' failed (exit N)` and a shell prompt.
- **Waiting panes** print `wool: waiting for setup...` until setup is done.
- **Notifications** (the shipped toast): success "wool: <branch> is ready";
  error "wool: setup failed" / "Step '<name>' failed in <branch>." (click:
  focuses the setup pane); error "wool: .herdr/<file> is invalid" with the
  problem and full path; warning for an agent that isn't installed; error for
  a background command that exited nonzero.

## How it behaves

- Agent statuses are Herdr's own; wool shows none. The agent tab is usable
  while setup runs (setup is a separate terminal).
- A new space is handled when its folder is a linked git worktree whose
  `<git-dir>/commondir` is under 3 minutes old and has no `<git-dir>/wool`
  folder yet. Spaces present when wool starts or reloads are never handled.
- "Plain shell" = one tab, one terminal pane, no agent status, and the
  terminal's argv is a bare shell (`["/bin/zsh", "-l"]`). Until `terminals()`
  reports that argv (about 80 ms after the pane), the space is pending; after
  10 s without it, it counts as not plain.
- Plain-shell space + `tabs` → layout + setup. Any other new worktree
  space → setup only, in an added `Setup` tab; focus goes back to the pane
  that had it. No `setup` and no layout → nothing.
- Setup runs once. Ctrl-C in its pane or closing its terminal stops the
  running step (the whole process tree) and marks it failed (`interrupted`).
- The space's original shell tab is closed only if its shell is still idle
  (terminal `foreground` is the shell itself); otherwise it stays and an info
  notification says so.
- Keys: none. Hovers and clicks: none (only the toast's click action).

## Built from

- `mods/wool/mod.json`:
  `{ "place": "none", "title": "wool", "overlay": { "kind": "window", "key": "wool", "keep": true, "frame": "none" } }`.
  Started once with `herdr-app do mod.open --name wool`; Herdr records it in
  `windows.json` under `kept.<layout>.wool` and reopens it on start.
- `mods/wool/main.js` (glue): `render()` seeds known space ids on the first
  render where `machines()` says this computer's layout isn't `loading`; on
  later renders it classifies new spaces with `spaces()`, `panes()`,
  `terminals()` and handles each in `cx.spawn`. Calls: `exec` (`sh` for the
  claim, writing `setup.sh`, `nohup` for background commands, `$SHELL`),
  `readTextFile` (config, `status`, `bg-<n>.exit`), `knownAgents()`,
  `focused()`, `notify`, and commands `tab.new {space, name, folder, argv,
  task}`, `pane.split {pane, direction, argv}`, `tab.close {id, confirmed:
  true}`, `pane.focus {pane}`. New tab/pane ids are found by diffing
  `spaces()`/`panes()` every 100 ms for up to 5 s after each command
  (`run()` returns nothing).
- `mods/wool/lib/` (pure, `node --test`): `yaml.js` (strict YAML subset),
  `schema.js` (validation + normalisation), `config.js` (lookup order:
  main `wool.yml`, worktree `wool.yml`, worktree `wool.yml.dist`, main
  `wool.yml.dist`), `detect.js` (classification, claim parsing), `shell.js` (setup script,
  argv builders), `plan.js` (steps: `tab`, `split`, `background`,
  `closeOriginal`, `focus`).
- `mods/wool/bin/` (POSIX `sh`): `wool-claim.sh` (`mkdir <git-dir>/wool` as an
  atomic claim; prints `claimed<TAB>git-dir<TAB>main<TAB>branch<TAB>top`),
  `wool-run.sh` (runs `setup.sh`, writes `status`: `running` → `ok` /
  `failed <step>`, traps HUP/INT/TERM and stops the step's process tree, then
  `exec`s the pane command),
  `wool-wait.sh` (polls `status` once a second; gives up on `failed`, a dead
  runner pid, or no status for 10 s), `wool-bg.sh` (background command to
  `bg-<n>.log`/`bg-<n>.pid`/`bg-<n>.exit`).
- No shipped mods are changed. Programs run: `git`, `sh`, `find`, `nohup`, and
  the repo's commands.

## Watch out

- A mod only runs while its block is in the layout. `place: bottom, size: 0`
  did not dock a new folder into the running app, and `layout.set` refuses a
  floating block on the shipped `main`; the kept window needs neither.
  Kept windows are per layout, and `mod.open` toggles.
- A briefed-agent space reports `program.key: "shell"` for its first ~120 ms;
  decide by terminal argv, never by `program`.
- `pane.split {argv}` runs argv bare: when it exits, the pane closes. Wrap a
  split's command as Herdr wraps `tab.new`'s:
  `[shell, "-lic", '"$@"; exec "$0" -li', shell, ...argv]`.
- `tab.new` takes focus and switches the window to its space. Give focus back
  with `pane.focus {pane}` for spaces you don't lay out.
- `git rev-parse --git-dir` is relative (`.git`) in a main checkout: compare
  `--path-format=absolute` dirs. Git sanitises a worktree's admin-dir name
  (`wt b` → `wt-b`).
- `exec` has a 30 s limit: setup must run in a terminal. A POSIX `sh` defers
  traps until a foreground child exits, so the runner runs setup in the
  background and `wait`s (keeping the tty on fd 3 for the steps' stdin).
- Herdr's hot reload doesn't follow a symlinked mod folder.
- Panes have no `title` or `size` (no such Herdr arguments); a `prompt` only
  reaches an agent in a tab's first pane (`pane.split` has no
  `task`).
- Remote spaces are skipped. Built and checked on Herdr app 0.1.12, macOS.

## Done when

1. `herdr-app check ~/.config/herdr-app/mods/wool` passes and `npm test` passes.
2. With the Laravel example in a repo, New worktree gives tabs Agent (focused,
   agent running), Shell, Server; Server shows the `.env` copy, `composer install`,
   `npm ci`, then `composer run dev`; the worktree's `.env` equals main's.
3. Text typed into the agent arrives while setup is still running.
4. A setup step `exit 1` stops setup; the error stays in Server; `composer run dev`
   doesn't start; an error notification names the step.
5. Saving `main.js` (in a real folder) adds no tabs and runs no setup in
   existing worktree spaces; neither does restarting the app.
6. Opening an old worktree (Open worktree) changes nothing.
7. `git worktree add` + `herdr-app do space.new --folder <wt> --argv '["claude"]' --task "…"`
   gives the briefed agent's tab (still focused) plus an unfocused `Setup` tab, and nothing else.
8. A personal `.herdr/wool.yml` with only a Shell tab (and no `setup`)
   gives only a Shell tab.
9. A repo with no `.herdr/` files gets nothing; a broken `wool.yml` gives an error
   notification naming it.
