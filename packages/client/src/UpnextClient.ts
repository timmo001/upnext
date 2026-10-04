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
  // watchers exit and their supervisor restarts them.
  static readonly layer = (socketPath: string) =>
    Layer.effect(UpnextClient, RpcClient.make(UpnextRpcs)).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(NodeSocket.layerNet({ path: socketPath })),
    );
}
