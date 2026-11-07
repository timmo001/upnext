---
title: upnext agent
description: Arguments and flags for every upnext agent command.
sidebar:
  label: agent
---

<!-- Generated from src/index.ts by `mise run docs:gen`. Do not edit by hand. -->

Every `upnext agent` command and its help, as `--help` prints it. Each also accepts the [global flags](/commands#global-flags).

## `upnext agent`

```text
DESCRIPTION
  The Code Mode tools the OpenCode plugin registers

USAGE
  upnext agent <subcommand> [flags]

INHERITED FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
```

## `upnext agent tools`

```text
DESCRIPTION
  Print the Code Mode tools as JSON, and whether the daemon's socket exists

USAGE
  upnext agent tools [flags]

FLAGS
  --json    Print as JSON (the only format)

INHERITED FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
```

## `upnext agent call`

```text
DESCRIPTION
  Run a Code Mode tool with its input as JSON on stdin and print its result as JSON

USAGE
  upnext agent call [flags] <tool>

ARGUMENTS
  tool choice    The tool to run, from upnext agent tools

INHERITED FLAGS
  --socket string    Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)
```
