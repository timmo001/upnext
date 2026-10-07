# upnext agents

`upnext` gathers Twitch live channels, YouTube uploads and live streams, and a watch-later queue into one feed. A daemon keeps the feed and serves it to local clients over a single Unix socket. It replaces `twitch-notifications`.

## Stack

- Runtime, package manager and compiler: Bun.
- Language: TypeScript with Effect v4. Read `node_modules/effect/ai-docs` and the Effect source before writing Effect code.
- Prefer Effect platform services (`FileSystem`, `Path`, `ChildProcessSpawner`, `Socket`, `SocketServer`, `effect/cli`) from `@effect/platform-bun` over hand-written Node or Bun wrappers.
- Prefer Effect's own modules (`Array`, `Option`, `String`, `Record`, `HashSet`, `Order`, `SynchronizedRef`, Schema defaults and codecs) over hand-written JavaScript equivalents.
- Task runner: mise.

## Layout

- `packages/shared` (`@timmo001/effect-upnext-shared`): the `MediaItem` schemas every source maps to.
- `packages/twitch` and `packages/youtube` (`@timmo001/effect-twitch`, `@timmo001/effect-youtube`): standalone platform clients that return `MediaItem`s. They know nothing about upnext's config files or socket.
- `packages/client` (`@timmo001/effect-upnext`): the socket protocol only (`UpnextRpcs`, `Feed`, requests, `UpnextClient`, `resolveSocketPath`). Shared schemas never go here.
- `src/`: the daemon, feed store, config, state and the CLI.

## Rules

- Keep the CLI tree in `src/index.ts` so help and completions come from one place.
- Every operation goes through the daemon socket. CLI commands are thin socket clients.
- Pin dependencies to exact versions (`bun add -E`).
- Run project tasks through mise. Scripts complex enough to need logic are written in Effect and exposed as mise tasks.
- New files use `.yml`, not `.yaml`. Config files are YAML, parsed with `Bun.YAML.parse` and decoded with Schema. Files the daemon writes for itself go in `state.json` under `$XDG_STATE_HOME/upnext`, apart from watched and saved items, which go in `library.json` under `$XDG_DATA_HOME/upnext` so they can be synced.
- Config the user may have stowed from a dotfiles repository must stay stowed. Write the replacement into the same stow package and link to it, as `src/config/legacy.ts` does.

## Background Dev Servers

- Start the docs dev server with `mise run serve:docs:dev`, which runs it through Pitchfork in the background and restarts it if it exits or stops responding. Do not run `mise run docs:dev` or `blume dev` in the foreground from an agent.
- Use `mise run serve:docs:status`, `mise run serve:docs:logs`, `mise run serve:docs:restart` and `mise run serve:docs:stop` to manage it.
- The docs server is configured in `pitchfork.toml` and serves `http://localhost:4321/`.
- Run a local daemon from source with `mise run serve:daemon`, managed the same way with `serve:daemon:status`, `serve:daemon:logs`, `serve:daemon:restart` and `serve:daemon:stop`. It runs `serve` in watch mode on `$XDG_RUNTIME_DIR/upnext/dev.sock`, so the installed service keeps its socket. Point clients at it with `UPNEXT_SOCK`.
- `mise run dev:start` runs the local daemon and the development Omarchy panel together. Use the matching `dev:status`, `dev:logs`, `dev:restart` and `dev:stop` tasks so the installed panel comes back.

## Validation

Run these after source changes:

```bash
mise run check ::: test ::: build
```

Run `mise run build:packages` after changing anything under `packages/`.

`mise run docs:gen` regenerates the command reference from the CLI's help and is slow. Only run it when a change touches commands, flags, arguments or their descriptions, and only once, at the end of the changeset. In a large change, leave it as its own final step.

## Packaging

- Pushes to `main` that touch the app publish the rolling `upnext-git` package through `.github/workflows/publish-arch-git.yml` to the signed `timmo` pacman repository. Published releases also build `upnext-bin` and publish the packages to npm and JSR.
- Install or update only through pacman after publication succeeds. Never install a locally built binary over the packaged one.
- Publication needs the `ARCH_REPO_DISPATCH_TOKEN` repository secret. The package allowlist lives in `timmo001/arch-repo/config/packages.json`.
