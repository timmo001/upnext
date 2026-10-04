---
title: Omarchy panel
description: See the feed from the Omarchy bar, open what's live and mark things watched.
---

The `timmo.upnext` plugin adds a bar widget and a panel to Omarchy. It reads the feed from the daemon, so `upnext.service` needs to be running.

## Install

```bash
omarchy plugin add https://github.com/timmo001/omarchy-upnext.git
```

Accept the prompt to enable the plugin. If you had `timmo.twitch` installed, remove it with `omarchy plugin remove timmo.twitch`.

## The widget

The widget shows how many of your channels are live, and hides itself when nothing is. Hover over the bar to reveal it.

- Click to open the panel.
- Middle-click to recheck every source.
- Right-click to restart `upnext.service`.

## The panel

The panel shows the feed in sections: live, upcoming, new uploads and watch later. Live followed channels that aren't in `channels.yml` come after your own.

- Type to filter, use Up and Down to move, and press Enter to open the selected item.
- Press Shift+Enter, or right-click, to mark a YouTube upload or a saved item watched.
- Press Ctrl+R to recheck.
- If a source needs you to sign in, it shows at the top. Select it to run `upnext auth`.

The panel follows `upnext watch --json`, so it updates as soon as the feed changes. When the daemon restarts, the panel reconnects within a few seconds.

## IPC

The plugin exposes the `timmo.upnext` IPC target, with `recheck`, `restart`, `open`, `close`, `show`, `hide` and `toggle`:

```bash
omarchy-shell shell toggle timmo.upnext
```
