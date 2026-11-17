# Which spaces wool acts on

When you create a git worktree in Herdr, Herdr opens a new space for it. This
page explains which of those spaces wool sets up, and what it does for each.
For the config file that defines the setup steps and tabs, see
[Configuration](configuration.md).

## When wool acts

wool acts on a space only when all of these are true:

- The space's folder is a linked git worktree. The main checkout is never
  handled.
- The worktree was created in the last 3 minutes. Opening an old worktree
  again does nothing.
- wool hasn't handled that worktree before.
- The space is on this machine. Remote spaces (on another machine) are
  skipped in this version.

Spaces that already exist when wool starts or reloads are never handled.

A worktree you create with `git worktree add` in a terminal and then open with
"Open worktree" within 3 minutes counts as new. That is on purpose.

## What wool does in each space

What wool does depends on how the new space arrives.

**One tab with a plain shell.** This is what "New worktree" and "Open
worktree" create. wool runs the setup steps and builds the layout from `tabs`.
If the config has no `tabs`, or has no pane with `setup: true`, setup runs in
an added "Setup" tab that doesn't take focus. With `setupIn: background`
there is no Setup tab unless setup fails; see
[Setup in the background](configuration.md#setup-in-the-background).

**Any other way.** For example a briefed agent started from a script, or the
worktree mod's `{branch, tab, argv}` form. wool runs the setup steps in an
added "Setup" tab that doesn't take focus. It ignores `tabs`: it never closes,
replaces or reorders tabs, and never starts a second agent.

## Running setup again

wool runs setup once per worktree. To run it again, see
[Troubleshooting](troubleshooting.md#running-setup-again).
