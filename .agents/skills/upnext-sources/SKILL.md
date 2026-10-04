---
name: upnext-sources
description: Change how upnext reads Twitch and YouTube, in packages/twitch, packages/youtube, packages/shared and src/sources, including sign-in, token refresh, Helix and EventSub, channel RSS feeds, the YouTube Data API, the watch-later playlist, MediaItem mapping, notifications and auto-open. Use when adding a platform request, decoding a new response shape, changing what appears in the feed or when, or touching quota and rate-limit handling.
license: Apache-2.0
compatibility: Requires mise and Bun from the upnext repository root. Live checks need Twitch and Google credentials in the user's upnext config.
---

# upnext sources

## Layout

- `packages/shared/src/Media.ts`: `Source`, `MediaKind` and `MediaItem`, the shape every source maps to. IDs are prefixed with their source: `twitch:<login>`, `youtube:<video ID>`, `link:<UUID>`.
- `packages/twitch` (`@timmo001/effect-twitch`): OAuth (`Auth.ts`), Helix schemas and `toMediaItem` (`Helix.ts`), the client (`TwitchClient.ts`) and EventSub `stream.online` over WebSocket (`EventSub.ts`).
- `packages/youtube` (`@timmo001/effect-youtube`): Google OAuth (`Auth.ts`), channel RSS feeds, `videos.list`, subscriptions, playlist items and oEmbed (`YouTubeClient.ts`), and URL helpers and `toMediaItem` (`Media.ts`).
- `src/sources/Twitch.ts` and `YouTube.ts`: the daemon services that run checks, keep tokens in `UpnextState`, write each source's slice with `FeedStore.setSource`, and decide what to announce and open.
- `src/sources/WatchLater.ts`: saved items in `library.json`, kept in step with the YouTube watch-later playlist when one is set, and `MarkWatched`.
- `src/sources/signIn.ts`: the loopback servers for OAuth redirects. `wakeups.ts` restarts sessions after the machine sleeps.

## Package boundary

The platform packages are published on their own. They take credentials and tokens as arguments, return `MediaItem`s and tagged errors, and know nothing about config files, `state.json`, `FeedStore` or the socket. Token storage is the caller's job, via `onTokens` for Twitch and the stored refresh token for YouTube. Keep upnext-specific behaviour, such as auto-open and notifications, in `src/sources`.

## Platform rules that shape the code

- Twitch:
  - The only scope is `user:read:follows`.
  - The redirect URI `http://localhost:8080/oauth/callback` must match the Twitch app registration, which twitch-notifications users already have, so don't change it.
  - Twitch asks apps to validate tokens hourly; `revalidate` does this.
  - Helix pages are capped at 100.
  - Rate limits are retried using the `ratelimit-reset` header.
- EventSub: each `stream.online` subscription costs 1, out of 10 per user token (`maxEventSubChannels`). It only makes a channel show up sooner; polling at `twitch.poll_interval` catches everything.
- YouTube:
  - Channel RSS feeds cost no quota but carry only the latest 15 uploads and no live state.
  - `videos.list` gives live and upcoming state, takes 50 IDs a call and uses quota. `YouTubeSource.check` looks up every feed entry from tracked channels, but only recent uploads from other subscriptions.
  - Upcoming streams show only for tracked channels, and ones over two hours past their start are dropped.
- Google sign-in:
  - Uses a Desktop app client, which may redirect to any loopback port (`127.0.0.1:8081`).
  - Asks for `youtube.readonly`, or `youtube` when a watch-later playlist is set so the playlist can be changed.
  - A 401, or a 403 with `insufficientPermissions`, becomes `YouTubeAuthError`, which sets the source to `auth-required`.
- Error messages never include response bodies, tokens or the API key. Keep secrets in `Redacted`.

## Feed behaviour to preserve

- `FeedStore.setSource` returns the items that weren't in the source's slice before, so notifications and auto-open happen in one place.
- The first check after startup announces only when `notify_on_startup` is set, and opens nothing by itself.
- A Twitch stream that drops and returns within 10 minutes isn't announced again.
- A YouTube channel's first read isn't announced, so adding one doesn't announce a week of uploads.
- A YouTube channel that fails to read keeps its previous items, so they don't come back as new.
- Watched YouTube IDs and saved items live in `library.json`, which can be synced between machines. Change them through `UpnextState.update`, which re-reads the file first so a synced change isn't overwritten.

## Making the change

- Decode only the fields upnext uses, with `Schema.optional` where the platform may omit them. An unknown literal or a missing required field fails the whole response.
- Fail with `TwitchError` or `YouTubeError` and a short context prefix, or the auth error when signing in again is the fix. In the daemon, turn them into a source status or `SourceError` with a message that says what to do, such as "Run upnext auth youtube to sign in".
- Export new modules from the package's `src/index.ts`, and update its README when the public API changes.
- Check claims against the platform docs before trusting them in code or comments: the Twitch API reference and EventSub docs, and the YouTube Data API reference and quota calculator.
- Run `mise run build:packages` as well as the root checks; the published `dist` builds with each package's `tsconfig.build.json`.
