---
title: Privacy policy
description: What Up Next does with your Twitch and Google data.
---

Up Next runs on your own computer. There's no Up Next server or account, and nothing you sign in with is sent to the developer.

## Google and YouTube

When you run `upnext auth youtube`, Up Next asks Google for read-only access to your YouTube account (the `youtube.readonly` scope). It uses that access to:

- read the list of channels you subscribe to;
- look up those channels' recent videos and live streams.

Up Next doesn't change anything on your YouTube account, and it doesn't read anything else from your Google account.

Google's refresh token is stored in `state.json` under `~/.local/state/upnext` on your computer, and the token is sent only to Google. The subscriptions and videos Up Next reads stay on your computer. They're shown only to apps on the same computer that connect to the daemon's socket, such as the `upnext` CLI and the Omarchy panel, and they're never sent anywhere.

Up Next's use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements.

To remove access, delete `youtube.refreshToken` from `state.json`, or remove Up Next from your [Google account's third-party connections](https://myaccount.google.com/connections).

## Twitch

When you sign in to Twitch, Up Next reads the channels you follow and which of them are live. Its tokens are stored in the same `state.json` and sent only to Twitch.

## This website

This documentation site doesn't use cookies or analytics. Cloudflare, which hosts it, keeps standard request logs.

## Contact

Questions about this policy go to [the issue tracker](https://github.com/timmo001/upnext/issues).
