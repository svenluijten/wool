# Configuration

wool reads a YAML file from your repo's `.herdr/` folder. It describes what
happens when a new worktree is created (setup steps and the tab layout) and
when it is removed (teardown steps).

Commit `.herdr/wool.yml.dist` to share a config with everyone on the repo. To
override it for yourself, create `.herdr/wool.yml` and add `.herdr/*.yml` to
your `.gitignore`. A `wool.yml` replaces the `.dist` file completely; nothing
is merged. With neither file, wool does nothing for that repo.

wool asks for your approval before it runs a file someone else could have
written. See [Trust and security](trust.md).

## Example

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
teardown:
  - name: Remove build cache
    run: rm -rf "$HERDR_MAIN_WORKTREE/.cache/$HERDR_BRANCH"
```

The first line points editors at the JSON schema,
[`schema/wool.schema.json`](../schema/wool.schema.json), for completion and
validation.

## Fields

`setup`, `tabs` and `teardown` are each optional, but the file needs at least
one of them. Setup without tabs is fine: it runs in an added "Setup" tab.
Tabs without setup are fine too.

| Field | Meaning |
|---|---|
| `version` | Required. Always `1`. |
| `env` | Environment variables for every setup step, pane and background command. A step's or pane's own `env` overrides these. |
| `setup[]` | Setup steps, run in order. The first step that exits nonzero stops setup. `[]` is valid. |
| `setup[].run` | Required. Runs as `/bin/sh -c <run>` in the new worktree. |
| `setup[].name` | The label shown while the step runs. Default: the command. |
| `setup[].env` | Extra environment variables for this step. |
| `tabs[]` | The tabs to create, in order (at least one). Only used when the space arrives as a plain shell; see [Which spaces wool acts on](spaces.md#what-wool-does-in-each-space). |
| `tabs[].title` | The tab's name. Default: its number. |
| `tabs[].panes[]` | The tab's panes (at least one). The first pane fills the tab; each later pane splits off the one before it. |
| `tabs[].panes[].command` | A command to run. It runs with `sh -c` inside your login shell, so it gets your `PATH` but not your aliases or shell functions. The shell stays open after the command exits, so a crash leaves its output on screen. |
| `tabs[].panes[].agent` | Start an agent instead of a command. `default` picks your most-used installed agent. You can also name one (`claude`, `codex`, …), which is mainly useful in a personal `wool.yml`. |
| `tabs[].panes[].prompt` | The agent's first message. Needs `agent`, and only works on a tab's first pane. |
| `tabs[].panes[].env` | Environment variables for this pane. |
| `tabs[].panes[].split` | `right` (default) or `down`. `vertical` and `horizontal` are accepted as aliases. Not allowed on a tab's first pane. |
| `tabs[].panes[].setup` | `true` on at most one pane, not an agent pane. This pane shows setup's output, then runs its own `command` once setup succeeds (without a `command`, it stays a shell). Without such a pane, setup runs in an added "Setup" tab. |
| `tabs[].panes[].waitForSetup` | The `command` waits for setup to finish, and doesn't run if setup fails. |
| `tabs[].panes[].focus` | `true` on at most one pane: it gets the keyboard when the space opens. Default: the first agent pane, otherwise the first pane. |
| `background[]` | Commands that run without a pane. See [Background commands](#background-commands). |
| `teardown[]` | Steps that run after the worktree is removed. Same fields as `setup[]`. See [Teardown](teardown.md). |

A pane with neither `command` nor `agent` is a plain shell.

wool rejects the file if it has unknown fields, a pane with both `command`
and `agent`, a `prompt` without `agent`, or more than one `setup: true` pane.

## Background commands

Each `background[]` entry has a `command` and optional `env` and
`waitForSetup`, with the same meaning as for panes. Background commands need
`tabs`.

wool writes each command's output, process ID and exit code to files in the
worktree's git dir: `wool/bg-<n>.log`, `wool/bg-<n>.pid` and
`wool/bg-<n>.exit`. To stop a command, kill the process ID in its `.pid` file.

If a command exits nonzero, you get a notification. wool stops watching after
a reload or an app restart; the files stay.

Background commands keep running after `git worktree remove`. Stop them
before you remove the worktree.

## Environment variables

wool sets these for setup and teardown steps only. Panes and background
commands don't get them.

| Variable | Value |
|---|---|
| `HERDR_WORKTREE` | The new worktree. Setup steps run here. During teardown it no longer exists. |
| `HERDR_MAIN_WORKTREE` | The repo's main checkout. Teardown steps run here. |
| `HERDR_BRANCH` | The new worktree's branch. Empty when the worktree is detached. |

## Where the file is read from

wool uses the first file it finds:

1. `<main checkout>/.herdr/wool.yml`: your personal file. It's gitignored, so
   it normally only exists in the main checkout.
2. `<new worktree>/.herdr/wool.yml`
3. `<new worktree>/.herdr/wool.yml.dist`: a branch that changes the `.dist`
   file gets its own version, and uncommitted edits in your main checkout
   don't leak in.
4. `<main checkout>/.herdr/wool.yml.dist`

## Supported YAML

wool has its own small YAML reader. It supports maps, lists, strings, numbers,
`true`/`false`, comments, `[]` and `{}`.

It rejects the following with a line number: tab indentation, `|` and `>`
block scalars, anchors and aliases, flow lists with items (`[a, b]`), and
multiple documents in one file. Quote any value that contains `: ` or ` #`.
