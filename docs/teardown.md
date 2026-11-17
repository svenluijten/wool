# Teardown

Teardown lets a repo clean up after a worktree. wool runs the steps in the
`teardown` list of its config file when a worktree it set up is removed. Use it
to undo things that setup created outside the worktree, such as a database.
This page covers when teardown runs, where, which steps it uses, and what to do
when it fails. The config file itself is described in
[Configuration](configuration.md).

## Example

```yaml
setup:
  - name: Create test database
    run: createdb "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"
teardown:
  - name: Drop test database
    run: dropdb --if-exists "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"
```

`teardown` steps have the same fields as `setup` steps and run in order. The
first step that exits nonzero stops teardown.

## When teardown runs

Teardown runs after the worktree's folder is gone. It runs in these cases:

- You remove a worktree that wool set up. Herdr's Remove worktree closes the
  space first and then deletes the folder. wool waits up to 10 minutes after
  the space closes for the folder to disappear, then runs teardown.
- wool starts and finds a worktree that was removed while it wasn't running,
  for example because Herdr was closed or you ran `git worktree remove` in a
  terminal. This check covers every repo that has a space open.

Closing a space without removing its worktree runs nothing, because the
worktree still exists.

## Where it runs

Teardown runs in the repo's main checkout, in the background. Nothing is shown
in a terminal.

The worktree's files are gone by then, so a step can't read the worktree's
`.env` or any other file in it. To find resources that setup created, work out
their names from `HERDR_BRANCH` in both setup and teardown, as the example
does. Teardown steps get the same variables as setup steps; see
[Environment variables](configuration.md#environment-variables).

## Which steps run

wool saves the `teardown` steps when it sets up the worktree, from the config
file that was in use at that time. Editing the file later doesn't change the
teardown of worktrees that already exist.

The saved steps are kept in `<repo>/.git/wool/<worktree name>/`. This folder is
in the repo's main git directory, so it survives `git worktree remove`.

## After teardown

wool shows a notification that says whether teardown worked.

If it worked, wool deletes the saved folder, and also `<repo>/.git/wool/` when
that is empty.

If a step failed, wool keeps the folder. The notification names the failed
step and the location of `teardown.log` in that folder. It also gives the
command to run teardown again:

```sh
sh "<wool>/bin/wool-teardown.sh" "<repo>/.git/wool/<worktree name>"
```

The notification shows the real paths, so copy the command from it. wool never
retries a failed teardown by itself. For other problems, see
[Troubleshooting](troubleshooting.md).
