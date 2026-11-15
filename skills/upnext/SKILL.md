---
name: upnext
description: Read what is live and new from followed Twitch and YouTube channels plus saved watch-later links, save a URL to watch later, mark items watched, follow or unfollow channels, and re-check the sources, through the upnext daemon. Use when asked what to watch, who is live, what new videos there are, to save or hide something, or to follow a channel.
---

# upnext

Prefer the `upnext` Code Mode namespace, which the OpenCode plugin registers
from `upnext agent tools --json`. Without it, fall back to the CLI with
`--json`. Both talk to the daemon on its socket (`--socket`, else
`$XDG_RUNTIME_DIR/upnext/upnext.sock`), so the daemon must be running. When a
call says it can't reach it, tell the person to start `upnext serve` (the
`upnext` user service) and stop.

`feed`, `candidates` and `agent tools` only read. `recheck`, `queue_add`,
`mark_watched`, `channel_add` and `channel_remove` write: Code Mode asks the
person before each. Never run a write unless the person asked for it.

1. Start with `feed` (`upnext feed --json`). Live streams come first, then new
   uploads, then saved items, with each source's status. If a source isn't
   healthy, say why from its status and don't treat its items as complete.
2. `recheck` checks every source, or one, for new items now. Only pass `open`
   when the person asks for live channels set to auto-open to be opened.
3. `queue_add` saves a URL to watch later. `mark_watched` hides YouTube
   uploads or removes saved items, by the ids `feed` gives.
4. `candidates` lists followed Twitch channels or YouTube subscriptions not in
   the feed yet, by the name `channel_add` takes. `channel_add` follows a
   Twitch login or YouTube channel ID, or changes its auto-open and
   notification settings; `channel_remove` stops following one.
