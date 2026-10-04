---
title: upnext channel
description: Arguments and flags for every upnext channel command.
sidebar:
  label: channel
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `upnext channel` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `upnext channel`

```text
DESCRIPTION
  Add or remove followed channels

USAGE
  upnext channel <subcommand> [flags]

FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
```

## `upnext channel add`

```text
DESCRIPTION
  Add a channel, or change whether it opens when live

USAGE
  upnext channel add [flags] <source> <name>

ARGUMENTS
  source choice    twitch or youtube
  name string      A Twitch login or a YouTube channel ID

FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
  --open             Open the channel as soon as it goes live
```

## `upnext channel remove`

```text
DESCRIPTION
  Remove a channel

USAGE
  upnext channel remove [flags] <source> <name>

ARGUMENTS
  source choice    twitch or youtube
  name string      A Twitch login or a YouTube channel ID

FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
```
