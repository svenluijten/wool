# Trust and security

wool runs the commands in a repo's `.herdr/wool.yml.dist` as you, with your
environment and permissions, whenever you create a worktree. Because of that,
wool asks you to approve a config file before it runs anything from it. This
page explains when wool asks, what your answers do, how to undo a decision, and
what the approval does and doesn't protect against.

Trusting a file is the same kind of trust you give `composer` scripts or npm
`postinstall` scripts. Read the file before you answer `t`.

## When wool asks

wool decides based on which config file the worktree would use (see
[Configuration](configuration.md) for how it picks one):

- A `wool.yml` that git ignores: wool doesn't ask. You wrote it, so it is
  trusted.
- A `wool.yml` that git doesn't ignore (it is committed, or not listed in
  `.gitignore`): wool asks.
- Any `wool.yml.dist`: wool asks.

wool does not ask when the file would run nothing for the worktree. It also
does not ask about an invalid file; it reports the error instead.

A trusted decision belongs to one exact version of the file. If the file
changes (a pull brings in a new `.dist`, or a branch edits it), its SHA-256
checksum changes and the next worktree asks again. A repo can have several
trusted versions at once, so older branches keep theirs.

wool saves a worktree's `teardown` steps only after you approve the file.
If you decline or don't answer, nothing is saved, so removing that worktree
runs no teardown. See [Teardown](teardown.md).

## The trust prompt

When a new worktree would run something from a file wool hasn't seen before,
wool runs nothing and adds one tab named `wool`. The tab shows the repo, the
file, its checksum and its full contents, and then asks:

```
[d]ecline  trust [o]nce  [t]rust project:
```

- **Decline** (`d`): wool does nothing for this worktree. It won't ask about
  this exact file again, so later worktrees that use it get nothing, without a
  prompt.
- **Trust once** (`o`): wool sets up this worktree as usual. Nothing is saved,
  so the next worktree asks again.
- **Trust project** (`t`): wool sets up this worktree and saves the file's
  checksum for this repo. Later worktrees that use the same file run without
  asking.

Until you answer, nothing from the file runs: no setup, no layout, no agent,
no background command and no teardown. The space's own tab stays usable.

Which tab has the keyboard depends on the kind of space:

- In a plain-shell space, the `wool` tab has the keyboard.
- In any other space (for example one started with an agent prompt), it
  doesn't. wool shows a warning notification, "wool: trust needed for
  <repo>", that takes you to the tab.

Closing the tab or pressing Ctrl-C counts as no answer: nothing is saved and
nothing runs.

## Managing decisions

Run these from a terminal (use `~/.config/herdr-app/mods/wool/bin/wool` if
`wool` isn't on your `PATH`; see [Installation](../README.md#installation)):

```sh
wool trust list               # every trusted and declined file
wool trust forget <folder>    # forget every decision for <folder>'s repo
wool rerun <folder>           # set up that worktree again (asks again if needed)
```

`rerun` is how you recover in these cases:

- You declined (run `trust forget`, then `rerun`).
- You closed the prompt without an answer.
- wool restarted while a prompt was open.
- You want to run setup for a worktree again.

`rerun` needs the worktree's space to be open in Herdr. It never trusts anything
by itself.

No command trusts a file. Trusting one takes an answer typed into wool's
prompt, so a README, a task or an agent can't tell wool to trust something.
Agents may use `trust list`, `trust forget` and `rerun`.

wool keeps decisions in `${XDG_CONFIG_HOME:-~/.config}/wool/trust.tsv`. Each
line holds the checksum, `trusted` or `declined`, the repo (its main
checkout), the file and the date. The file is outside the mod folder, so
reinstalling wool keeps your decisions.

## Limits

The trust prompt does not protect you from software that already runs as you.
A malicious `postinstall` script or an agent can edit a config file, or type
into the prompt's terminal. The prompt makes sure you see a repo's commands
before they first run. It is not a sandbox.

## What wool itself touches

wool runs programs (`git`, `sh`, the setup steps, and the commands in
`wool.yml`). It reads files outside its own folder: the `.herdr/` files in your
repos, its state in their git directories, and its trust store in
`~/.config/wool/`.

The only thing wool deletes is its own teardown record,
`<repo>/.git/wool/<name>/`. `wool teardown` refuses to delete any folder
that isn't one. wool doesn't use the network.
