---
title: Set up Twitch
description: Create a Twitch application, sign in and pick the channels Up Next tracks.
---

Up Next signs in to Twitch with an application you register yourself. Once it's signed in, it shows every channel you follow that's live, and notifies you about the ones you add to `channels.yml`.

## 1. Register a Twitch application

1. Open the [Twitch developer console](https://dev.twitch.tv/console/apps) and sign in with your Twitch account. Twitch asks you to turn on two-factor authentication first if it isn't already.
2. Select **Register Your Application**.
3. Fill in the form:
   - **Name**: anything unique, such as `upnext-<your name>`.
   - **OAuth Redirect URLs**: `http://localhost:8080/oauth/callback`
   - **Category**: Application Integration.
   - **Client Type**: Confidential.
4. Select **Create**, then **Manage** on the new application.
5. Copy the **Client ID**, then select **New Secret** and copy the secret. Twitch only shows the secret once.

## 2. Add it to config.yml

Put both values in `~/.config/upnext/config.yml`:

```yaml
twitch:
  client_id: your-client-id
  client_secret: your-client-secret
```

To keep them out of the file, use environment variables instead, such as `client_id: ${TWITCH_CLIENT_ID}`. The daemon only sees variables set in its own environment, so for the systemd service set them with `systemctl --user edit upnext.service`.

Restart the daemon so it reads the change:

```bash
systemctl --user restart upnext.service
```

## 3. Sign in

```bash
upnext auth twitch
```

Your browser opens Twitch's sign-in page. Up Next only asks to read who you follow. Once you approve it, the command prints `Signed in.` and the feed starts showing your followed channels that are live.

The daemon listens on port 8080 only while you sign in. It keeps the tokens in `state.json` and refreshes them itself. If they stop working, the Twitch status in the feed changes to `auth-required` and a notification asks you to sign in again. Clicking it runs `upnext auth twitch`.

## 4. Pick your channels

Every live channel you follow shows in the feed. Add the ones you care most about to `channels.yml`. Those come first, in the order you list them, and they're the only ones that notify you when they go live.

Run `upnext channel add` with no name to pick from the channels you follow:

```bash
upnext channel add twitch
```

Move with Up and Down, press Space to pick each channel, then Enter to add them. Add `--open` to open them in your browser as soon as they go live.

You can also add a channel by its login:

```bash
upnext channel add twitch some_streamer --open
```

Twitch's live events cover up to 10 channels from `channels.yml`, so those show up within seconds. The rest are checked every `twitch.poll_interval` seconds, 60 by default.
