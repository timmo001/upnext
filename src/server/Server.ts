import { BunSocket, BunSocketServer } from "@effect/platform-bun";
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
import { FetchHttpClient } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";
import { SourceError, UpnextRpcs } from "@timmo001/effect-upnext";
import type { Source } from "@timmo001/effect-upnext-shared";
import { Desktop } from "../desktop/Desktop.js";
import { FeedStore } from "../feed/Feed.js";
import { TwitchSource } from "../sources/Twitch.js";
import { WatchLater } from "../sources/WatchLater.js";
import { YouTubeSource } from "../sources/YouTube.js";
import { UpnextState } from "../state/State.js";

const Handlers = UpnextRpcs.toLayer(
  Effect.gen(function* () {
    const feed = yield* FeedStore;
    const twitch = yield* TwitchSource;
    const youtube = yield* YouTubeSource;
    const watchLater = yield* WatchLater;

    const recheckSource = (source: Source, open: boolean) => {
      switch (source) {
        case "twitch":
          return twitch.recheck(open);
        case "youtube":
          return youtube.recheck(open);
        case "link":
          return Effect.void;
      }
    };

    const noChannels = (source: Source) =>
      Effect.fail(
        new SourceError({ source, message: `${source} has no channels` }),
      );

    return UpnextRpcs.of({
      GetFeed: () => feed.get,
      WatchFeed: () => feed.changes,
      Recheck: ({ source, open }) =>
        Option.match(Option.fromUndefinedOr(source), {
          // A source that isn't running doesn't fail a recheck of them all.
          onNone: () =>
            Effect.forEach(
              ["twitch", "youtube"] as const,
              (each) =>
                recheckSource(each, open).pipe(
                  Effect.catch((error) =>
                    Effect.logDebug("Skipped recheck", error.message),
                  ),
                ),
              { concurrency: "unbounded", discard: true },
            ),
          onSome: (only) => recheckSource(only, open),
        }),
      SignIn: ({ source }) =>
        source === "twitch"
          ? Effect.map(twitch.signIn, (url) => ({ url }))
          : Effect.fail(
              new SourceError({
                source,
                message: `${source} doesn't need signing in`,
              }),
            ),
      AddChannel: ({ source, name, open }) => {
        switch (source) {
          case "twitch":
            return twitch.addChannel(name, Option.fromUndefinedOr(open));
          case "youtube":
            return youtube.addChannel(name, Option.fromUndefinedOr(open));
          case "link":
            return noChannels(source);
        }
      },
      RemoveChannel: ({ source, name }) => {
        switch (source) {
          case "twitch":
            return twitch.removeChannel(name);
          case "youtube":
            return youtube.removeChannel(name);
          case "link":
            return noChannels(source);
        }
      },
      QueueAdd: ({ url, title }) =>
        watchLater.add(url, Option.fromUndefinedOr(title)),
      MarkWatched: ({ id }) => watchLater.markWatched(id),
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
          Layer.provide(
            Layer.mergeAll(
              TwitchSource.layer,
              YouTubeSource.layer,
              WatchLater.layer,
            ),
          ),
          Layer.provide(
            Layer.mergeAll(
              UpnextState.layer,
              Desktop.layer,
              FetchHttpClient.layer,
              BunSocket.layerWebSocketConstructor,
            ),
          ),
          Layer.provide(RpcServer.layerProtocolSocketServer),
          Layer.provide(RpcSerialization.layerNdjson),
          Layer.provide(quietSocketServer(socketPath)),
          Layer.provide(FeedStore.layer),
        ),
      ),
    ),
  );
