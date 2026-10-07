# Up Next docs

The [Up Next](https://github.com/timmo001/upnext) documentation site, built with Blume and Astro. It's available at <https://upnext.timmo.dev>.

## Commands

Run these from the repository root:

- `mise run docs:dev`: run the dev server
- `mise run docs:build`: build the site
- `mise run docs:preview`: preview the built site
- `mise run docs:gen`: regenerate the command reference from the CLI's help

Shared layout, components and config defaults come from [`@timmo001/docs-kit`](https://github.com/timmo001/docs-kit). Run `bun run brand` in `docs` to regenerate `public/logo.png`, `public/apple-touch-icon.png` and the GitHub social preview from `src/assets/logo.svg`.

## Deployment

The site deploys to Cloudflare Workers with Blume's Astro server bundle, which also serves the read-only docs MCP at `/mcp`. Workers Builds uses:

- Root directory: `docs`
- Production branch: `main`
- Build command: `bun run build`
- Deploy command: `bun run deploy`
- Non-production deploy command: `bun run deploy:preview`

`wrangler.jsonc` owns the Worker name, compatibility settings, custom domain and observability. The Astro Cloudflare adapter writes the deployable config to `dist/server/wrangler.json`, which the deploy scripts use.
