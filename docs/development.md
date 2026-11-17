# Development

This page is for working on wool itself. To use wool in a repo, see the
[README](../README.md).

## Run the tests

```sh
npm test
```

This runs `node --test tests/*.test.js`. The tests need only Node.js; they
don't need Herdr.

## Install a development copy

Link the mod folder instead of copying it, so your edits apply without
copying again:

```sh
ln -s "$PWD/mods/wool" ~/.config/herdr-app/mods/wool
herdr-app check ~/.config/herdr-app/mods/wool
herdr-app do mod.open --name wool
```

`herdr-app check` validates the mod folder. `mod.open` starts wool. See
[Installation](../README.md#installation) for what `mod.open` does and how to
turn wool off.

## Reload after editing

Herdr's hot reload does not follow a symlinked mod folder. After you edit a
file through the link, run this twice to restart wool:

```sh
herdr-app do mod.open --name wool
```

`mod.open` toggles: the first run closes wool and the second opens it again.

## Where the code lives

All files are under `mods/wool/`.

- `main.js` is the glue. It watches Herdr for new and removed spaces and runs
  the steps that `lib/` plans.
- `lib/` holds the decisions, each tested with `node --test`:
  - `yaml.js`: reads the YAML subset that config files use.
  - `schema.js`: validates the parsed config.
  - `config.js`: finds and loads `.herdr/wool.yml` or `.herdr/wool.yml.dist`.
  - `detect.js`: decides what a newly seen space is.
  - `plan.js`: plans the tab layout.
  - `shell.js`: generates the setup and teardown scripts.
  - `trust.js`: reads the output of the trust check.
- `bin/` holds the POSIX `sh` scripts that run in terminals or in the
  background:
  - `wool-claim.sh`: marks a worktree as handled by wool.
  - `wool-run.sh`: runs the setup script and records the result.
  - `wool-wait.sh`: waits for setup to finish before it runs a command.
  - `wool-bg.sh`: runs a background command.
  - `wool-trust.sh`: wool's trust gate for config files.
  - `wool-records.sh`: lists the teardown records of a repo.
  - `wool-teardown.sh`: runs teardown steps once the worktree is gone.
- `mod.json` tells Herdr to run wool as an invisible window.

Tests are in `tests/`, one file per `lib/` module plus `main.test.js` and
`examples.test.js`.
