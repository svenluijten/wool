# Trust: live acceptance

Herdr app 0.1.13, macOS, quiz (`~/Code/github.com/svenluijten/quiz`, its
uncommitted Laravel `.herdr/wool.yml.dist`).

## Status: not run (blocked), 2026-11-04

After re-pointing `~/.config/herdr-app/mods/wool` and restarting wool with
`herdr-app do mod.open --name wool` (twice; `herdr-app status` listed
`"wool"` under overlays), wool never rendered: a new quiz worktree space was
not claimed, and temporary debug writes from `render()` never appeared.
The **main checkout's** wool behaved the same after the same restart (a probe
repo's fresh worktree wasn't claimed), so this is the restart, not this
branch. Most likely the kept window doesn't render while the Herdr window
isn't frontmost. The last worktree wool claimed before the restart was
quiz's `feat-game-uuids` (19:37).

| # | Check | Result |
|---|---|---|
| 1 | New worktree, no entry → only a `wool` tab, nothing runs | not run |
| 2 | `t` → layout + setup; `list` shows `trusted` | not run |
| 3 | Next worktree → no prompt | not run |
| 4 | Edited `.dist` → asks again; `o` runs, store unchanged | not run |
| 5 | `d` → nothing, info notification; next worktree silent | not run |
| 6 | `forget` + `run` → asks again | not run |
| 7 | Gitignored personal `wool.yml` → no prompt | not run |
| 8 | Prompt tab closed → `none` notification with `run` hint | not run |
