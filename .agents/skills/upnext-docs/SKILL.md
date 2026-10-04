---
name: upnext-docs
description: Maintain the upnext docs site in docs/ (Blume and Astro, deployed to upnext.timmo.dev). Use when editing docs pages, the sidebar or the docs build, and when a change to CLI commands, flags, feed JSON, RPCs, config files, packaging, the Omarchy panel or the published libraries needs the docs updating.
license: Apache-2.0
compatibility: Requires mise and Bun from the upnext repository root.
---

# upnext docs

The site lives in `docs/` and is its own Bun project with its own `bun.lock`. Content is in `docs/src/content/docs/`; file names map to routes, and every page must be listed in the sidebar in `docs/blume.config.ts`.

## Keep the docs in step

- After changing commands, arguments, flags or their descriptions in `src/index.ts`, run `mise run docs:gen` once, at the end of the changeset. It rewrites `docs/src/content/docs/commands/` and `docs/commands-sidebar.json` from the CLI's `--help`. Never edit those by hand; the Docs workflow fails when they're out of date.
- Hand-written pages describe behaviour, so check the source before documenting it rather than copying older docs:
  - `configuration.md`: `src/config/Config.ts` for settings and defaults, `src/state/State.ts` for `state.json` and `library.json`, and `packages/client/src/socketPath.ts` for the socket order.
  - `setup/twitch.md` and `setup/youtube.md`: `src/sources/signIn.ts` for redirect URIs, and the scopes in each package's `Auth.ts`.
  - `privacy.md`: what each source sends and stores. Recheck it whenever a scope, a stored token or a new request changes.
  - `running.md`: `.scripts/linux/upnext.service` and `upnext.install`.
  - `libraries.md`: the RPC table from `packages/client/src/Rpcs.ts`. Library usage belongs in `packages/*/README.md`; this page only summarises and links.
  - `omarchy.md`: `omarchy-plugin/`, and keep it in step with `omarchy-plugin/README.md`.
  - `from-twitch-notifications.md`: `src/config/legacy.ts`.
- Use plain Markdown links. The repository's markdownlint config rejects inline HTML.

## Verify

Run from the repository root:

```bash
mise run docs:build
(cd docs && bun run check && bun run validate)
bunx markdownlint-cli2
```

`docs:build` runs Blume in strict mode; `validate` catches broken internal links. Preview with `mise run serve:docs:dev` rather than running the dev server in the foreground.

## Deployment

Cloudflare Workers Builds deploys `main` from the `docs` root directory with `bun run build` and `bun run deploy`, as `docs/README.md` describes. Don't edit the generated `docs/.blume/` runtime.
