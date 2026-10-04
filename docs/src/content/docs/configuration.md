---
title: Configuration
description: Set up Twitch and YouTube, choose your channels and find where upnext keeps its files.
---

upnext reads two files from `$XDG_CONFIG_HOME/upnext`, which is usually `~/.config/upnext`. Only `upnext serve` reads them; every other command talks to the daemon socket.

If you used twitch-notifications, upnext imports its config on first run. See [Migrating from twitch-notifications](/from-twitch-notifications).

## config.yml

```yaml
notify_on_startup: true
sound_file: /usr/share/sounds/freedesktop/stereo/message-new-instant.oga
twitch:
  client_id: ${TWITCH_CLIENT_ID}
  client_secret: ${TWITCH_CLIENT_SECRET}
  poll_interval: 60
youtube:
  api_key: ${YOUTUBE_API_KEY}
  poll_interval: 600
```

Every setting is optional.

- `notify_on_startup`: notify about channels that are already live when the daemon starts. Defaults to `true`.
- `sound_file`: a sound to play with each notification.
- `twitch.client_id` and `twitch.client_secret`: your Twitch application's credentials.
- `twitch.poll_interval`: seconds between checks for channels that live notifications don't cover. Defaults to 60.
- `youtube.api_key`: a YouTube Data API key. Without one, upnext still shows new uploads, but can't tell which videos are live or upcoming.
- `youtube.poll_interval`: seconds between YouTube checks. Defaults to 600.

Values can use `$VAR` or `${VAR}` to read environment variables, so you can keep secrets out of the file.

## channels.yml

```yaml
twitch:
  - name: alveussanctuary
    open: true
  - name: cinna
youtube:
  - id: UCXuqSBlHAE6Xw-yeJA0Tunw
```

- `twitch`: Twitch logins. upnext also shows every channel you follow that's live, even if it isn't listed here.
- `youtube`: YouTube channel IDs, the part after `/channel/` in a channel's URL.
- `open`: open the channel in your browser as soon as it goes live. Defaults to `false`.

`upnext channel add` and `upnext channel remove` change this file for you.

If you keep `channels.yml` in a dotfiles repository and link it into place with stow, upnext writes changes through the link, so your repository stays the source.

## State

The daemon keeps files it writes for itself in `$XDG_STATE_HOME/upnext/state.json`, which is usually `~/.local/state/upnext/state.json`: Twitch tokens, videos you've marked watched and your watch-later queue. You don't need to edit it.

The config and state directories are only readable by you (`0700`) and the files by you (`0600`).

## Socket path

Commands find the daemon socket in this order:

1. `--socket <path>`
2. `$UPNEXT_SOCK`
3. `$XDG_RUNTIME_DIR/upnext/upnext.sock`
4. `$TMPDIR/upnext-$USER/upnext.sock`, falling back to `/tmp` and `default`

`upnext serve` uses the same order to decide where to listen, so the defaults always match.
