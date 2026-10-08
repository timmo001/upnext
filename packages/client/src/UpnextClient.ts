import { NodeSocket } from "@effect/platform-node-shared";
import { Context, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import { UpnextRpcs } from "./Rpcs.js";

export class UpnextClient extends Context.Service<
  UpnextClient,
  RpcClient.FromGroup<typeof UpnextRpcs, RpcClientError>
>()("UpnextClient") {
  // Calls fail when the daemon is unreachable instead of waiting for it, so
  // watchers exit and their supervisor restarts them. The ping timeout
  // defaults to the ping interval, so a pong that lands a moment after the
  // next tick drops a healthy connection. Allow a few missed pings instead.
  static readonly layer = (socketPath: string) =>
    Layer.effect(UpnextClient, RpcClient.make(UpnextRpcs)).pipe(
      Layer.provide(
        RpcClient.layerProtocolSocket({ pingTimeout: "15 seconds" }),
      ),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(NodeSocket.layerNet({ path: socketPath })),
    );
}
