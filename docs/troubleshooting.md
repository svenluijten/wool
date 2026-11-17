# Troubleshooting

This page covers what to do when wool doesn't do what you expected for a new
git worktree in Herdr: setup fails, nothing seems to happen, or the layout is
not what the config describes. wool shows most problems as a Herdr
notification. Find the symptom below.

For how wool decides whether to act on a space at all, see
[Which spaces wool acts on](spaces.md).

## Setup failed

A notification says "setup failed" and names the step. Click it to go to the
setup pane.

- **A step exited with an error.** Setup stops at that step. The step's output
  and `wool: step '<name>' failed (exit N)` stay on screen, and nothing that
  waits for setup (`waitForSetup` panes and background commands) starts. Fix
  the problem, then [run setup again](#running-setup-again).
- **Setup was interrupted.** If you pressed Ctrl-C in the setup pane or closed
  its terminal, wool stops the running step and counts setup as failed
  (`interrupted`). Anything waiting for setup gives up.

Quitting the Herdr app does not interrupt setup, because terminals keep
running in herdr-core. wool does skip the "ready" or "failed" notification in
that case.

## Nothing happened for a new worktree

wool is silent when it has nothing to do. Check these in order:

1. **The space doesn't qualify.** wool only acts on a linked git worktree
   created in the last 3 minutes. See [Which spaces wool acts on](spaces.md).
2. **There is no config file.** wool needs `.herdr/wool.yml` or
   `.herdr/wool.yml.dist`. See [Configuration](configuration.md).
3. **You declined the config earlier.** wool remembers a decline and stays
   silent when it sees the same file again. See
   [Trust and security](trust.md#managing-decisions) to undo it.

## wool skipped the worktree

A notification says "skipped" in one of two cases:

- You declined the trust prompt. See
  [Trust and security](trust.md#managing-decisions) to undo it.
- You closed the trust prompt without answering. The notification includes the
  command to ask again, which is the one under
  [Running setup again](#running-setup-again).

## The config is rejected

A notification names the file and the problem, with the line number for YAML
errors. wool does nothing else for that worktree. Fix the file, then
[run setup again](#running-setup-again). For the rules the file must follow,
see [Configuration](configuration.md).

## The layout is not what I expected

- **Agent panes are plain shells.** wool couldn't find an installed agent, so
  it opened shells instead and showed a warning.
- **Your first tab is still open.** If you typed into the new space's shell
  before wool laid it out and something is still running there, wool keeps
  that tab and says so in a notification.
- **There are no layout tabs at all.** wool only lays out spaces that arrive
  as a single tab with a plain shell. Other spaces get only the "Setup" tab.
  See [Which spaces wool acts on](spaces.md).

## A notification says setting up stopped

Something went wrong after wool claimed the worktree and before setup started.
The notification says what happened and gives the command to
[run setup again](#running-setup-again).

## A teardown step failed

See [Teardown](teardown.md).

## Running setup again

wool runs setup once per worktree. To run wool for a worktree again, run this
in any terminal, with the worktree's folder as the last argument:

```sh
sh ~/.config/herdr-app/mods/wool/bin/wool-trust.sh run <folder>
```

wool handles the worktree as if it were new, whatever its age, and clears its
earlier state for that worktree. It asks for trust again if it needs to (see
[Trust and security](trust.md)). It does not run if wool is not running, if
the folder is not a linked worktree, if the worktree has no open space in
Herdr, or while its setup is still running.

## Where wool keeps its state

wool keeps its per-worktree state in the worktree's private git directory,
`<repo>/.git/worktrees/<name>/wool/`. It holds the claim, `setup.sh`, `status`,
`setup.log` (with `setupIn: background`), the background command logs, and `config.yml`, the copy of the config that wool
checksummed. It never shows in `git status` and goes away with
`git worktree remove`.
