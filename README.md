# wool

A mod for the [Herdr](https://herdr.dev) app that allows you to hook into a worktree's "created" and "removed" events. 

When a worktree space is created, `wool` runs the repo's setup steps (copy `.env`, install dependencies, …) 
in a terminal you can watch, and lays out the space's tabs: your agent, a shell, a dev server that starts
once setup has succeeded. When that worktree is removed, its teardown steps run (remove test database, remove
proxy, clean up dev server, …). All of this can be configured in a declarative YAML file committed to the repo,
with an option for personal overrides.

- Setup runs **once**, for any new worktree space, however it was made.
- The agent tab opens **immediately** and has the keyboard while setup runs.
- Commands that need setup (a dev server) wait for it, and don't start if it
  fails. A failure stays on screen and posts a notification.
- Spaces that arrive with something already in them (a briefed agent) are
  never rearranged: `wool` only adds a "Setup" tab behind them.
- Nothing from a repo's config runs until you've trusted **its exact
  contents**. See [Trust and security](docs/trust.md) for more info.

## Installation

> [!CAUTION]
> `wool` runs `git`, `sh` and your repo's setup commands, and reads `.herdr/`
> files in your repos. See [Trust and security](docs/trust.md) for more information.

1. Copy (or link) [`mods/wool`](mods/wool) into `~/.config/herdr-app/mods/`:

   ```sh
   git clone https://github.com/svenluijten/wool ~/Code/wool
   mkdir -p ~/.config/herdr-app/mods/wool
   cp -R ~/Code/wool/mods/wool/. ~/.config/herdr-app/mods/wool
   herdr-app check ~/.config/herdr-app/mods/wool
   ```

2. Start it, once:

   ```sh
   herdr-app do mod.open --name wool
   ```

   `wool` runs as an invisible window. Herdr keeps it and reopens it every time the app
   starts, so there is no layout to edit and the shipped `main` layout stays as it is.

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
  - name: Create test database
    run: createdb "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"

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

teardown:
  - name: Drop test database
    run: dropdb --if-exists "app_$(printf %s "$HERDR_BRANCH" | tr -c 'a-zA-Z0-9' _)"
```

Commit it. Now **New worktree** (the space menu or the + menu) gives a space
with three tabs: your agent (focused, ready to type into), a shell, and
Server, which shows `composer install` and `npm ci` scrolling by and then
becomes `composer run dev`.

More examples:

- [`examples/node`](examples/node/.herdr): `npm ci`; Agent, Shell, Dev
  (`npm run dev`).
- [`examples/setup-only`](examples/setup-only/.herdr): setup only; the space
  keeps its tabs and gets a "Setup" tab.

## Documentation

- [Configuration](docs/configuration.md): file locations, every field,
  environment variables.
- [Which spaces wool acts on](docs/spaces.md): when `wool` runs setup and lays
  out tabs.
- [Trust and security](docs/trust.md): the trust prompt and what `wool` is
  allowed to do.
- [Teardown](docs/teardown.md): cleaning up when a worktree is removed.
- [Troubleshooting](docs/troubleshooting.md): errors, failures, and running
  setup again.
- [Development](docs/development.md): working on `wool` itself.
