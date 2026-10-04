import { BunSocketServer } from "@effect/platform-bun";
import {
  Cause,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Predicate,
} from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";
import { ItemNotFound, SourceError, UpnextRpcs } from "@timmo001/effect-upnext";
import { FeedStore } from "../feed/Feed.js";

// Sources land in later stages; until then their requests fail plainly.
const notAvailable = () =>
  Effect.fail(new SourceError({ message: "not available yet" }));

const Handlers = UpnextRpcs.toLayer(
  Effect.gen(function* () {
    const feed = yield* FeedStore;

    return UpnextRpcs.of({
      GetFeed: () => feed.get,
      WatchFeed: () => feed.changes,
      Recheck: notAvailable,
      AddChannel: notAvailable,
      RemoveChannel: notAvailable,
      QueueAdd: notAvailable,
      MarkWatched: ({ id }) => Effect.fail(new ItemNotFound({ id })),
    });
  }),
);

const currentUid = () => process.getuid?.();

// `readlink` on a real directory fails with EINVAL. Any other failure is
// reported as-is.
const isNotASymlink = (error: PlatformError.PlatformError) =>
  Predicate.hasProperty(error.reason.cause, "code") &&
  error.reason.cause.code === "EINVAL";

const refuseDirectory = (directory: string, description: string) =>
  Effect.fail(
    PlatformError.badArgument({
      module: "FileSystem",
      method: "prepareSocket",
      description: `${directory}: ${description}`,
    }),
  );

// The socket is mode 0600, but whoever can write the parent directory can
// delete it and bind their own. `mkdir` leaves an existing directory's mode
// and owner alone, so a directory created earlier by someone else, or left
// world-writable, would keep that access.
export const prepareSocket = Effect.fn("prepareSocket")(function* (
  socketPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(socketPath);

  yield* fs.makeDirectory(directory, {
    recursive: true,
    mode: 0o700,
  });

  const symlink = yield* fs.readLink(directory).pipe(
    Effect.as(true),
    Effect.catchIf(isNotASymlink, () => Effect.succeed(false)),
  );

  if (symlink) {
    return yield* refuseDirectory(
      directory,
      "socket directory must not be a symbolic link",
    );
  }

  const info = yield* fs.stat(directory);

  if (info.type !== "Directory") {
    return yield* refuseDirectory(
      directory,
      "socket path is not inside a directory",
    );
  }

  const owner = Option.getOrUndefined(info.uid);
  const uid = currentUid();

  if (owner !== undefined && uid !== undefined && owner !== uid) {
    return yield* refuseDirectory(
      directory,
      "socket directory is owned by another user",
    );
  }

  yield* fs.chmod(directory, 0o700);
  yield* fs.remove(socketPath, { force: true });
});

const disconnectCodes = new Set(["ECONNRESET", "EPIPE"]);

const isDisconnect = (error: unknown): error is Socket.SocketError => {
  if (!Socket.isSocketError(error)) {
    return false;
  }

  const { reason } = error;

  if (Predicate.isTagged(reason, "SocketCloseError")) {
    return true;
  }

  return (
    (Predicate.isTagged(reason, "SocketReadError") ||
      Predicate.isTagged(reason, "SocketWriteError")) &&
    Predicate.hasProperty(reason.cause, "code") &&
    disconnectCodes.has(String(reason.cause.code))
  );
};

// Clients come and go (bars restart watchers), so a dropped connection is
// logged at debug level instead of as an unhandled server error.
const quietSocketServer = (socketPath: string) =>
  Layer.effect(
    SocketServer.SocketServer,
    Effect.gen(function* () {
      const server = yield* SocketServer.SocketServer;

      return SocketServer.SocketServer.of({
        address: server.address,
        run: (handler) =>
          server.run((socket) =>
            handler(socket).pipe(
              // The RPC protocol turns read errors into defects.
              Effect.catchCauseIf(
                (cause) => isDisconnect(Cause.squash(cause)),
                () => Effect.logDebug("Client disconnected"),
              ),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(BunSocketServer.layer({ path: socketPath })));

// Requiring SocketServer orders this after the socket is listening.
const secureSocket = (socketPath: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* SocketServer.SocketServer;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.chmod(socketPath, 0o600);
      yield* Effect.addFinalizer(() =>
        fs.remove(socketPath, { force: true }).pipe(Effect.ignore),
      );
      yield* Effect.logInfo("Listening", socketPath);
    }),
  );

export const serve = (socketPath: string) =>
  prepareSocket(socketPath).pipe(
    Effect.andThen(
      Layer.launch(
        Layer.mergeAll(
          RpcServer.layer(UpnextRpcs),
          secureSocket(socketPath),
        ).pipe(
          Layer.provide(Handlers),
          Layer.provide(RpcServer.layerProtocolSocketServer),
          Layer.provide(RpcSerialization.layerNdjson),
          Layer.provide(quietSocketServer(socketPath)),
          Layer.provide(FeedStore.layer),
        ),
      ),
    ),
  );
