---
name: upnext-commands
description: Add or change upnext CLI commands, daemon RPCs and the feed JSON that clients read. Use when editing src/index.ts, src/server/Server.ts, packages/client/src/Rpcs.ts, Requests.ts or Feed.ts, or when exposing a new operation, read or stream to the CLI, the Omarchy panel or other socket clients.
license: Apache-2.0
compatibility: Requires mise and Bun from the upnext repository root.
---

# upnext commands

Every operation goes through the daemon socket. CLI commands are thin clients of `UpnextClient` and never read config, state or a platform API themselves.

## Pick the smallest path

Check whether an existing RPC already does the job before adding one. `Recheck`, `AddChannel` and `QueueAdd` take options, so a new flag on an existing command often needs only a new optional field on its request.

A new RPC touches, in order:

1. `packages/client/src/Requests.ts`: the payload and result schemas, and any new tagged error. Shared media schemas stay in `packages/shared`; the client package only holds the protocol.
2. `packages/client/src/Rpcs.ts`: the `Rpc.make` entry, with `error: SourceError` when a source can refuse it. It is the published protocol, so renaming or reshaping an RPC breaks `@timmo001/effect-upnext` users and the Omarchy panel.
3. The daemon service that does the work: a method on `TwitchSource`, `YouTubeSource`, `WatchLater` or `FeedStore`. Platform calls belong in `packages/twitch` or `packages/youtube`; see `upnext-sources`.
4. `src/server/Server.ts`: the handler in `Handlers`. TypeScript fails until every RPC has one. Handlers switch on `Source`, so cover `link` explicitly rather than letting it fall through.
5. `src/index.ts`: the command.

## CLI conventions

- Wrap every client effect in `withDaemon`, which resolves the socket and turns `RpcClientError` into a "Could not reach the daemon" message.
- Fail with `CommandError`; `reportCliCause` prints `upnext: <message>` and sets exit code 1. Map tagged RPC errors to a `CommandError` with a plain message, as `watched` does with `ItemNotFound`.
- Reuse `jsonFlag`, `openFlag`, `sourceArgument` and `channelName`. Use `channelSources` rather than `Source.literals` when `link` makes no sense.
- Write feed and item output through `printLine`, not `Console.log`, which drops output past the pipe buffer and cut large feeds short for the panel. Status and progress messages go to stderr with `Console.error`.
- Interactive prompts (`Prompt.Select`, `Prompt.MultiSelect`) only run when an argument is left out, so scripts and the panel can always pass everything.

## Contracts

- `feed --json` and `watch --json` print the `Feed` schema from `packages/client/src/Feed.ts`, one JSON object per line. The Omarchy panel (`omarchy-plugin/Service.qml`) parses every line and reads `sources[].state`, `items[].item.kind`, `.source`, `.id`, `.url`, `.channel.id`, `.thumbnailUrl`, `items[].tracked` and `autoOpen`. Treat removing or renaming any field, or changing a `SourceState` or `MediaKind` literal, as a breaking change.
- The panel also runs `recheck [--open]`, `watched <id>...`, `channel add <source> <name>`, `queue add <url>` and `auth <source>`. Keep those arguments working, and check `Service.qml` after changing any of them.
- The plain-text feed line is tab-separated: kind, source, channel or `-`, title, URL.
- Item IDs are `twitch:<login>`, `youtube:<video ID>` or `link:<UUID>`, and `watched` takes them as shown by `feed --json`.

## Verify

- Add `bun:test` tests beside the source for pure logic, such as feed ordering in `src/feed/Feed.ts`; leave command wiring to the checks.
- Update the RPC table in `docs/src/content/docs/libraries.md` for a new or changed RPC, and `packages/client/README.md` when the client API changes.
- Run `mise run check`, `mise run test` and `mise run build`, and `mise run build:packages` after changing `packages/`.
- Try the change against a local daemon as `upnext-review` describes.
- Run `mise run docs:gen` once, at the end, after changing commands, arguments, flags or their descriptions.
