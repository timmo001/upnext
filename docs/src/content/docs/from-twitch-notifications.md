---
title: Migrating from twitch-notifications
description: What upnext imports from twitch-notifications, and what changes.
---

upnext replaces twitch-notifications. The packages replace `twitch-notifications-git`, so installing upnext removes it.

## What's imported

On first run, if `~/.config/upnext/config.yml` doesn't exist and `~/.config/twitch-notifications/config.yaml` does, upnext copies:

| From `twitch-notifications` | To `upnext` |
| --- | --- |
| `config.yaml` `notify_on_startup`, `sound_file` | `config.yml`, same keys |
| `config.yaml` `poll_interval` | `config.yml` `twitch.poll_interval` |
| `config.yaml` `twitch.client_id`, `twitch.client_secret` | `config.yml`, same keys, keeping any `${VAR}` references |
| `channels.yml` `watched_channels` | `channels.yml` `twitch` |
| `config.yaml` `twitch.access_token`, `twitch.refresh_token` | `state.json` |

`system_tray` is dropped, as upnext has no tray icon.

If a twitch-notifications file is a link into a dotfiles repository, such as one made by stow, the new file is written into the same stow package and linked into place the same way. Your dotfiles stay the source.

The old directory isn't changed, so you can go back to twitch-notifications if you need to.

## What changes

| twitch-notifications | upnext |
| --- | --- |
| Autostarted by your desktop session | `upnext.service` systemd user service |
| `twitch-notifications --status-json` | `upnext feed --json` |
| `twitch-notifications --recheck` | `upnext recheck` |
| `twitch-notifications-recheck --open` | `upnext recheck --open` |
| `twitch-notifications-restart` | `systemctl --user restart upnext.service` |
| `timmo.twitch` Omarchy plugin | `timmo.upnext` Omarchy plugin |
| System tray icon | The Omarchy panel |
