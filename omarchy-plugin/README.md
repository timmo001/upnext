# Up Next for Omarchy

An Omarchy bar widget and panel for [Up Next][upnext]. It shows Twitch live
channels, YouTube uploads and live streams, and your watch-later queue in one
feed, and opens or marks them watched.

## Requirements

- Omarchy Quattro
- `upnext` on `PATH`, with `upnext.service` running

The daemon owns credentials, channels and notifications. Follow the
[Up Next configuration guide][setup] before enabling this plugin.

## Install

Review the repository, then add the plugin:

```bash
omarchy plugin add https://github.com/timmo001/omarchy-upnext.git
```

Accept the prompt to enable the plugin during installation.

For an unattended install from a repository you already trust:

```bash
omarchy plugin add https://github.com/timmo001/omarchy-upnext.git \
  --enable --yes
```

## Use

Select the widget to open its panel. The feed is split into live, upcoming,
new uploads and watch later. Type to filter, use Up and Down to move through
the list, press Enter to open the selected item, and press Escape to clear the
filter or close the panel. Press Shift+Enter, or right-click, to mark a YouTube
upload or a saved item watched. Press Ctrl+R to recheck every source.

Middle-click the widget to recheck. Right-click it to restart the daemon.

The plugin follows `upnext watch --json`, so the panel updates as soon as the
feed changes. If the daemon stops, the plugin reconnects every five seconds.
Live previews refresh when the panel opens and every minute while it stays
open. Each item keeps its last loaded image until a replacement loads.

The plugin exposes the `timmo.upnext` shell IPC target with `recheck`,
`restart`, `open`, `close`, `show`, `hide`, and `toggle` methods:

```bash
omarchy-shell shell toggle timmo.upnext
```

## Settings

- `primaryOnly`: show the widget only on the selected output
- `primaryOutput`: optional output name used when `primaryOnly` is enabled;
  the first available output is used when this is empty or unavailable
- `revealOnHover`: reveal the normally hidden widget while hovering the bar

Credentials, channels, auto-open, polling and notifications stay in Up Next's
`~/.config/upnext/config.yml` and `channels.yml`. They are not plugin settings.

## Update

```bash
omarchy plugin update timmo.upnext
```

## Remove

```bash
omarchy plugin remove timmo.upnext
```

Removing the plugin does not remove Up Next or its configuration.

## Validate from source

```bash
omarchy plugin validate .
```

## Security

This plugin runs unsandboxed inside `omarchy-shell` when enabled. Review its
source before installing it.

The plugin runs these local commands:

```text
upnext watch --json
upnext recheck [--open]
upnext watched <id>
upnext auth <source>
systemctl --user restart upnext.service
xdg-open <URL>
omarchy-launch-webapp <URL>
```

The daemon, not the plugin, holds tokens and API keys, talks to Twitch and
YouTube, sends notifications and applies auto-open rules. The plugin opens the
URLs you select and loads thumbnails from Twitch and YouTube's public image
hosts. It does not read credentials, write Omarchy configuration, run
privileged commands, or install software.

[upnext]: https://upnext.timmo.dev
[setup]: https://upnext.timmo.dev/configuration
