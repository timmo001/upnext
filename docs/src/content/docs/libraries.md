---
title: Libraries
description: Use the upnext feed from your own Effect app.
---

upnext is built from Effect v4 libraries, published to npm and JSR. They work under Bun and Node.

| Package | Use it to |
| --- | --- |
| [`@timmo001/effect-upnext`](https://github.com/timmo001/upnext/tree/main/packages/client) | Talk to a running daemon over its socket |
| [`@timmo001/effect-upnext-shared`](https://github.com/timmo001/upnext/tree/main/packages/shared) | Use the `MediaItem` schemas every source and client shares |

The CLI is a client of the same RPCs that `effect-upnext` defines, so anything the CLI does, your app can do too.

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
| `AddChannel`, `RemoveChannel` | Change `channels.yml` |
| `QueueAdd` | Saves a URL to watch later |
| `MarkWatched` | Hides a YouTube upload or removes a saved item |

Calls fail with `RpcClientError` when the daemon isn't reachable rather than waiting for it to come back.
