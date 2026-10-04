---
name: upnext-release
description: Version, release and package upnext and its published libraries (@timmo001/effect-upnext, effect-upnext-shared, effect-twitch and effect-youtube), and publish the Omarchy plugin. Use when bumping versions, preparing or publishing a GitHub release, debugging the Release, Publish Arch git package or Publish Omarchy plugin workflows, or editing the PKGBUILDs, nfpm config, systemd user service or install hooks in .scripts/linux/.
license: Apache-2.0
compatibility: Requires mise, Bun and the GitHub CLI from the upnext repository root.
---

# Releasing upnext

One version covers the CLI and all four libraries. A published, non-prerelease GitHub release runs `.github/workflows/release.yml`, which publishes `effect-upnext-shared` to npm and JSR first, then `effect-twitch`, `effect-youtube` and `effect-upnext`, which pin it. It also builds the Linux binaries, deb and rpm packages, and `upnext-bin` for Arch. Prereleases publish nothing.

## Bump the version

The publish workflows compare the release tag with every manifest, so the tag must be the exact version, with no `v` prefix, as in `0.1.2`. Set the same version in:

- `package.json` (the CLI reads `--version` from it)
- `package.json` and `jsr.json` in each of `packages/shared`, `packages/twitch`, `packages/youtube` and `packages/client`

Then run `mise run version:sync` to pin each package's `@timmo001/effect-upnext-shared` dependency to it, and `bun install` to refresh `bun.lock`; CI installs with `--frozen-lockfile`. Run `mise run check`, `mise run test`, `mise run build` and `mise run build:packages` before committing.

Releasing is a public, irreversible publish. Commit, push and create the release only when the user asks for each step, and use their chosen version.

## Packaging

- `.scripts/linux/PKGBUILD` builds `upnext-git` from source. `publish-arch-git.yml` publishes it on pushes to `main` that touch the source, packages or packaging. Its `pkgver` comes from `package.json`.
- `.scripts/linux/PKGBUILD.bin` is a template; the release renders `pkgver` and checksums from the tag. Don't edit those values by hand.
- `.scripts/linux/nfpm.yml` builds the release's deb and rpm packages.
- A packaged file, such as a change to `upnext.service` or a new installed file, must be updated in all three, in the `extraFiles` of the `prepare-arch-bin` job when `upnext-bin` needs it, and in the `paths` of `publish-arch-git.yml`.
- The PKGBUILDs provide, conflict with and replace the `twitch-notifications` packages, so upgrades move people across. Keep that while anyone may still have them installed.
- `upnext.install` enables the user service globally and starts it for the installing user. Keep upgrades to `try-restart` so a service the user stopped stays stopped.
- The Lint package configs workflow runs namcap on PKGBUILD changes, and the shellcheck job in Lint general covers `.scripts/`.
- Publishing needs the `ARCH_REPO_DISPATCH_TOKEN` secret, and the package names must be allowed in `timmo001/arch-repo`'s `config/packages.json`.

## Omarchy plugin

The plugin is versioned apart from the CLI, in `omarchy-plugin/manifest.json`. Bump it with every plugin change: patch for fixes and tweaks, minor for new features. `publish-omarchy-plugin.yml` validates the manifest and lints the QML on pull requests, and on `main` copies the plugin to `timmo001/omarchy-upnext`, which is what `omarchy plugin add` and `omarchy plugin update` install. A new file in `omarchy-plugin/` must be added to every file list in `.github/scripts/bash/publish-omarchy-plugin.sh` and its `.test.sh`, or validation fails.

## After a release

Install only published packages: upgrade from the signed `timmo` pacman repository once the workflow succeeds, then check `pacman -Qo "$(command -v upnext)"` and `pacman -Q upnext-git` (or `upnext-bin`). Never install a local build or a locally built package over the packaged one.
