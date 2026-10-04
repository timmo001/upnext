# Up Next

What's live, what's new and what you saved for later, in one feed.

`upnext` watches the Twitch channels you follow, your YouTube channels and subscriptions, and a watch-later queue. A small daemon keeps the feed, sends desktop notifications when something goes live and serves the feed to local apps over a Unix socket. The `upnext` CLI and the Omarchy panel both read from it.

It replaces `twitch-notifications`. On first run it imports your old config, channels and Twitch tokens, and keeps any stowed config files stowed.

See the [documentation](https://upnext.timmo.dev) to install, configure and use it.

## Packages

| Package | What it's for |
| --- | --- |
| [`@timmo001/effect-upnext`](packages/client) | Effect client and protocol for the daemon socket |
| [`@timmo001/effect-twitch`](packages/twitch) | Effect client for Twitch sign-in, Helix and EventSub live events |
| [`@timmo001/effect-youtube`](packages/youtube) | Effect client for YouTube channel feeds, live streams, subscriptions, Google sign-in and oEmbed |
| [`@timmo001/effect-upnext-shared`](packages/shared) | The media item schemas every source and client shares |

## Licence

Apache 2.0. See [LICENSE](LICENSE).
