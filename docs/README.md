# Up Next docs

The [Up Next](https://github.com/timmo001/upnext) documentation site, built with Blume and Astro. It's available at <https://upnext.timmo.dev>.

## Commands

Run these from the repository root:

- `mise run docs:dev`: run the dev server
- `mise run docs:build`: build the site
- `mise run docs:preview`: preview the built site
- `mise run docs:gen`: regenerate the command reference from the CLI's help
- `mise run docs:plan`: build the site, then show what a deploy would change
- `mise run docs:deploy`: build and deploy the site

Shared layout, components and config defaults come from [`@timmo001/docs-kit`](https://github.com/timmo001/docs-kit). Run `bun run brand` in `docs` to regenerate `public/logo.png`, `public/apple-touch-icon.png` and the GitHub social preview from `src/assets/logo.svg`.

## Deployment

The site deploys to Cloudflare Workers with Blume's Astro server bundle, which also serves the read-only docs MCP at `/mcp`. `alchemy.run.ts` is the Alchemy stack for the `upnext-docs` Worker at upnext.timmo.dev, and the Deploy docs workflow deploys it on pushes to `main`.

CI's Cloudflare token and the repository secrets it reads come from `stacks/github.ts`. Deploy it once from a machine with `mise run docs:deploy:github`, and again to rotate the token.
