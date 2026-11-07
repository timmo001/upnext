---
title: Libraries
description: Use the Up Next feed from your own Effect app.
---

Up Next is built from Effect v4 libraries, published to npm and JSR. They work under Bun and Node.

| Package | Use it to |
| --- | --- |
| [`@timmo001/effect-upnext`](https://github.com/timmo001/upnext/tree/main/packages/client) | Talk to a running daemon over its socket |
| [`@timmo001/effect-twitch`](https://github.com/timmo001/upnext/tree/main/packages/twitch) | Sign in to Twitch, find live channels and turn them into `MediaItem`s, without the daemon |
| [`@timmo001/effect-youtube`](https://github.com/timmo001/upnext/tree/main/packages/youtube) | Read YouTube channel feeds and live streams and turn them into `MediaItem`s, without the daemon |
| [`@timmo001/effect-upnext-shared`](https://github.com/timmo001/upnext/tree/main/packages/shared) | Use the `MediaItem` schemas every source and client shares |

The CLI is a client of the same RPCs that `effect-upnext` defines, so anything the CLI does, your app can do too.

## OpenCode plugin

The OpenCode plugin in `opencode-plugin/` gives OpenCode an `upnext` Code Mode namespace, so an agent can read the feed, save links and follow channels. Load it from the repository:

```json
{
  "plugins": ["github:timmo001/upnext#main::path:opencode-plugin"]
}
```

It reads its tools from `upnext agent tools --json` and runs each with `upnext agent call`, so they always match the `upnext` on your `PATH`. It needs a [running daemon](/running), and leaves the namespace out when the daemon's socket isn't there. Tools that change something ask first, and "always allow" on `channel_add` or `channel_remove` covers one source.

## Client

```bash
bun add @timmo001/effect-upnext @timmo001/effect-upnext-shared effect
```

`effect` is a peer dependency, so install the Effect v4 version your app already uses.

`UpnextClient` is an Effect service built on `effect/rpc`. `UpnextClient.layer(socketPath)` opens the Unix socket and speaks newline-delimited JSON. The connection lives as long as the layer, so provide it once around the work that needs it.

`resolveSocketPath` finds the socket the same way the CLI does. See [Socket path](/configuration#socket-path).

```ts
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { resolveSocketPath, UpnextClient } from "@timmo001/effect-upnext";
import { Console, Effect, Option, Stream } from "effect";

const program = Effect.gen(function* () {
  const client = yield* UpnextClient;

  yield* client.WatchFeed().pipe(
    Stream.runForEach((feed) =>
      Console.log(
        `${feed.items.filter(({ item }) => item.kind === "live").length} live`,
      ),
    ),
  );
});

const main = Effect.gen(function* () {
  const socketPath = yield* resolveSocketPath(Option.none());

  yield* program.pipe(Effect.provide(UpnextClient.layer(socketPath)));
});

main.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
```

## RPCs

| RPC | Does |
| --- | --- |
| `GetFeed` | Returns each source's status and every item |
| `WatchFeed` | Streams the whole feed, then again after each change |
| `Recheck` | Checks every source, or one, now |
| `SignIn` | Starts signing in to Twitch or Google and returns the page the daemon opened |
| `AddChannel`, `RemoveChannel` | Change `channels.yml` |
| `ListCandidates` | Followed Twitch channels or YouTube subscriptions not in `channels.yml` yet |
| `QueueAdd` | Saves a URL to watch later, in the watch-later playlist for a YouTube video when one is set |
| `MarkWatched` | Hides YouTube videos or removes saved items, given a list of IDs |

Calls fail with `RpcClientError` when the daemon isn't reachable rather than waiting for it to come back.
