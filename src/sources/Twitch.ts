import {
  Array as Arr,
  DateTime,
  Duration,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  HashMap,
  Layer,
  Context,
  Option,
  Queue,
  Redacted,
  Ref,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  String as Str,
} from "effect";
import { HttpClient } from "effect/http";
import {
  authorizeUrl,
  exchangeCode,
  make as makeTwitchClient,
  maxEventSubChannels,
  toMediaItem,
  type TokenOwner,
  TwitchAuthError,
  type TwitchClientService,
  type TwitchCredentials,
  type TwitchStream,
  type TwitchTokens,
} from "@timmo001/effect-twitch";
import {
  type FeedItem,
  SourceError,
  type SourceState,
} from "@timmo001/effect-upnext";
import { UpnextConfig } from "../config/Config.js";
import { Desktop } from "../desktop/Desktop.js";
import { FeedStore } from "../feed/Feed.js";
import { UpnextState } from "../state/State.js";
import { listenForCode, redirectUri } from "./twitchSignIn.js";
import { wakeups } from "./wakeups.js";

const retryDelay = Duration.seconds(30);

const validateInterval = Duration.hours(1);

const signInTimeout = Duration.minutes(5);

// A stream that drops and comes back within this long isn't announced again.
const reconnectWindow = Duration.minutes(10);

const notConfigured =
  "Set twitch.client_id and twitch.client_secret in config.yml";

const signInMessage = "Run upnext auth twitch to sign in";

const twitchError = (message: string) =>
  new SourceError({ source: "twitch", message });

const loginKey = (name: string) => Str.toLowerCase(Str.trim(name));

export interface TwitchSourceService {
  // Checks now. With `open`, opens every live channel set to auto-open.
  readonly recheck: (open: boolean) => Effect.Effect<void, SourceError>;
  // Starts signing in and returns the page the browser was sent to.
  readonly signIn: Effect.Effect<string, SourceError>;
  readonly addChannel: (
    name: string,
    open: Option.Option<boolean>,
  ) => Effect.Effect<void, SourceError>;
  readonly removeChannel: (name: string) => Effect.Effect<void, SourceError>;
}

interface Session {
  readonly client: TwitchClientService;
  readonly check: (open: boolean) => Effect.Effect<void, TwitchAuthError>;
}

export class TwitchSource extends Context.Service<
  TwitchSource,
  TwitchSourceService
>()("TwitchSource") {
  static readonly layer = Layer.effect(
    TwitchSource,
    Effect.gen(function* () {
      const config = yield* UpnextConfig;
      const state = yield* UpnextState;
      const feed = yield* FeedStore;
      const desktop = yield* Desktop;
      const http = yield* HttpClient.HttpClient;
      const provideHttp = Effect.provideService(HttpClient.HttpClient, http);

      const current = yield* Ref.make(Option.none<Session>());
      const restart = yield* Queue.sliding<void>(1);
      const checking = yield* Semaphore.make(1);
      // False until the first check, which counts as startup.
      const started = yield* Ref.make(false);
      const lastSeen = yield* Ref.make(HashMap.empty<string, DateTime.Utc>());
      const authNotified = yield* Ref.make(false);
      const signInHandle = yield* FiberHandle.make<void, never>();

      const requestRestart = Queue.offer(restart, undefined).pipe(
        Effect.asVoid,
      );

      const setState = (
        sourceState: SourceState,
        message: Option.Option<string>,
        items: Option.Option<ReadonlyArray<FeedItem>>,
      ) =>
        Effect.flatMap(DateTime.now, (checkedAt) => {
          const status = {
            source: "twitch" as const,
            state: sourceState,
            checkedAt,
            ...Option.match(message, {
              onNone: () => ({}),
              onSome: (value) => ({ message: value }),
            }),
          };

          return Option.match(items, {
            onNone: () => feed.setStatus(status),
            onSome: (value) =>
              feed.setSource(status, value).pipe(Effect.asVoid),
          });
        });

      const credentials = Effect.flatMap(config.settings, ({ twitch }) =>
        Str.isNonEmpty(twitch.clientId) &&
        Str.isNonEmpty(Redacted.value(twitch.clientSecret))
          ? Effect.succeedSome<TwitchCredentials>({
              clientId: twitch.clientId,
              clientSecret: twitch.clientSecret,
            })
          : Effect.succeedNone,
      );

      const saveTokens = (tokens: TwitchTokens) =>
        state.update((previous) => ({
          ...previous,
          twitch: {
            accessToken: Redacted.value(tokens.accessToken),
            refreshToken: Option.getOrUndefined(
              Option.map(tokens.refreshToken, Redacted.value),
            ),
          },
        }));

      const storedTokens = Effect.map(state.get, ({ twitch }) =>
        Option.map(
          Option.filter(
            Option.fromUndefinedOr(twitch?.accessToken),
            Str.isNonEmpty,
          ),
          (accessToken): TwitchTokens => ({
            accessToken: Redacted.make(accessToken),
            refreshToken: Option.map(
              Option.filter(
                Option.fromUndefinedOr(twitch?.refreshToken),
                Str.isNonEmpty,
              ),
              Redacted.make,
            ),
            expiresAt: Option.none(),
          }),
        ),
      );

      const announce = (feedItem: FeedItem) =>
        desktop.notify({
          title: `${feedItem.item.channel?.name ?? feedItem.item.title} is live`,
          body: Option.match(Option.fromUndefinedOr(feedItem.item.category), {
            onNone: () => feedItem.item.title,
            onSome: (category) => `${feedItem.item.title}\n${category}`,
          }),
          url: feedItem.item.url,
          sound: true,
        });

      // Items not seen live within the reconnect window, and remembers what's
      // live now.
      const freshItems = (
        items: ReadonlyArray<FeedItem>,
        added: ReadonlyArray<FeedItem>,
        now: DateTime.Utc,
      ) =>
        Ref.modify(lastSeen, (seen) => {
          const cutoff = DateTime.subtractDuration(now, reconnectWindow);

          const fresh = Arr.filter(added, ({ item }) =>
            Option.match(HashMap.get(seen, item.id), {
              onNone: () => true,
              onSome: (at) => DateTime.isLessThan(at, cutoff),
            }),
          );

          const kept = HashMap.filter(seen, (at) =>
            DateTime.isGreaterThanOrEqualTo(at, cutoff),
          );

          return [
            fresh,
            Arr.reduce(items, kept, (map, { item }) =>
              HashMap.set(map, item.id, now),
            ),
          ] as const;
        });

      const checkWith =
        (client: TwitchClientService, owner: TokenOwner) => (open: boolean) =>
          Effect.gen(function* () {
            const settings = yield* config.settings;
            const channels = (yield* config.channels).twitch;

            const tracked = HashMap.fromIterable(
              Arr.map(channels, ({ name, open }) => [loginKey(name), open]),
            );

            const [followed, trackedLive] = yield* Effect.all(
              [
                client.followedStreams(owner.userId),
                client.streams(Arr.fromIterable(HashMap.keys(tracked))),
              ],
              { concurrency: "unbounded" },
            );

            const items = Arr.map(
              Arr.dedupeWith(
                Arr.appendAll(trackedLive, followed),
                (a: TwitchStream, b: TwitchStream) => a.user_id === b.user_id,
              ),
              (stream): FeedItem => {
                const autoOpen = HashMap.get(
                  tracked,
                  loginKey(stream.user_login),
                );

                return {
                  item: toMediaItem(stream),
                  tracked: Option.isSome(autoOpen),
                  autoOpen: Option.getOrElse(autoOpen, () => false),
                };
              },
            );

            const now = yield* DateTime.now;

            const added = yield* feed.setSource(
              { source: "twitch", state: "ok", checkedAt: now },
              items,
            );

            const fresh = yield* freshItems(items, added, now);
            const startup = !(yield* Ref.getAndSet(started, true));

            // At startup everything live is new, so it's only announced when
            // notify_on_startup is set, and nothing opens by itself.
            const toAnnounce = startup
              ? settings.notifyOnStartup
                ? Arr.filter(added, ({ tracked }) => tracked)
                : []
              : Arr.filter(fresh, ({ tracked }) => tracked);

            const toOpen = open
              ? Arr.filter(items, ({ autoOpen }) => autoOpen)
              : startup
                ? []
                : Arr.filter(fresh, ({ autoOpen }) => autoOpen);

            yield* Effect.forEach(toAnnounce, announce, { discard: true });

            yield* Effect.forEach(
              toOpen,
              ({ item }) => desktop.open(item.url),
              {
                discard: true,
              },
            );
          }).pipe(
            Effect.catchTags({
              TwitchError: (error) =>
                Effect.logWarning("Twitch check failed", error.message).pipe(
                  Effect.andThen(
                    setState(
                      "error",
                      Option.some(error.message),
                      Option.none(),
                    ),
                  ),
                ),
              ConfigError: (error) =>
                setState("error", Option.some(error.message), Option.none()),
            }),
            Semaphore.withPermit(checking),
            Effect.withSpan("TwitchSource.check"),
          );

      const session = Effect.gen(function* () {
        const found = yield* credentials;

        if (Option.isNone(found)) {
          yield* setState(
            "disabled",
            Option.some(notConfigured),
            Option.some([]),
          );

          return yield* Effect.never;
        }

        const tokens = yield* storedTokens;

        if (Option.isNone(tokens)) {
          return yield* new TwitchAuthError({ message: "not signed in" });
        }

        const settings = yield* config.settings;

        const client = yield* makeTwitchClient({
          ...found.value,
          tokens: tokens.value,
          onTokens: (next) =>
            saveTokens(next).pipe(
              Effect.catch((error) =>
                Effect.logError(
                  "Could not save the Twitch token",
                  error.message,
                ),
              ),
            ),
        }).pipe(provideHttp);

        const owner = yield* client.validate;
        yield* Effect.logInfo("Signed in to Twitch as", owner.login);
        yield* Ref.set(authNotified, false);

        const check = checkWith(client, owner);
        yield* Ref.set(current, Option.some({ client, check }));
        yield* check(false);

        // EventSub only makes a channel show up sooner. Polling catches
        // everything else.
        const channels = (yield* config.channels).twitch;

        const users = yield* client.users(
          Arr.take(
            Arr.map(channels, ({ name }) => loginKey(name)),
            maxEventSubChannels,
          ),
        );

        const eventSub = client
          .streamOnline(Arr.map(users, ({ id }) => id))
          .pipe(
            Stream.tap((event) =>
              Effect.logInfo("Went live", event.broadcaster_user_login),
            ),
            Stream.runForEach(() => check(false)),
          );

        const poll = check(false).pipe(
          Effect.repeat(Schedule.spaced(settings.twitch.pollInterval)),
          Effect.delay(settings.twitch.pollInterval),
        );

        const revalidate = client.validate.pipe(
          Effect.catchTag("TwitchError", (error) =>
            Effect.logWarning("Twitch token check failed", error.message),
          ),
          Effect.repeat(Schedule.spaced(validateInterval)),
          Effect.delay(validateInterval),
        );

        return yield* Effect.all([eventSub, poll, revalidate], {
          concurrency: "unbounded",
          discard: true,
        }).pipe(Effect.andThen(Effect.never));
      }).pipe(Effect.scoped);

      const needsSignIn = (error: TwitchAuthError) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("Twitch needs signing in", error.message);

          yield* setState(
            "auth-required",
            Option.some(signInMessage),
            Option.some([]),
          );

          if (!(yield* Ref.getAndSet(authNotified, true))) {
            yield* desktop.notify({
              title: "Sign in to Twitch",
              body: "Click to sign in, or run upnext auth twitch",
              command: "upnext auth twitch",
            });
          }

          return yield* Effect.never;
        });

      const failed = (message: string) =>
        Effect.logWarning("Twitch failed", message).pipe(
          Effect.andThen(
            setState("error", Option.some(message), Option.none()),
          ),
          Effect.andThen(Effect.sleep(retryDelay)),
        );

      // Runs one session at a time until something asks for a restart, such
      // as signing in, changing channels or waking from sleep.
      yield* session.pipe(
        Effect.catchTags({
          TwitchAuthError: needsSignIn,
          TwitchError: (error) => failed(error.message),
          ConfigError: (error) => failed(error.message),
        }),
        Effect.raceFirst(Queue.take(restart)),
        Effect.ensuring(Ref.set(current, Option.none())),
        Effect.forever,
        Effect.forkScoped,
      );

      yield* wakeups.pipe(
        Stream.runForEach(() => requestRestart),
        Effect.forkScoped,
      );

      const inactiveMessage = Effect.map(feed.get, ({ sources }) =>
        Option.getOrElse(
          Option.flatMap(
            Arr.findFirst(sources, ({ source }) => source === "twitch"),
            ({ message }) => Option.fromUndefinedOr(message),
          ),
          () => "Twitch isn't running yet",
        ),
      );

      const recheck = (open: boolean) =>
        Effect.flatMap(
          Ref.get(current),
          Option.match({
            onNone: () =>
              Effect.flatMap(inactiveMessage, (message) =>
                Effect.fail(twitchError(message)),
              ),
            onSome: ({ check }) =>
              check(open).pipe(
                Effect.catchTag("TwitchAuthError", (error) =>
                  requestRestart.pipe(
                    Effect.andThen(Effect.fail(twitchError(error.message))),
                  ),
                ),
              ),
          }),
        );

      const signIn = Effect.gen(function* () {
        const found = yield* credentials.pipe(
          Effect.mapError((error) => twitchError(error.message)),
        );

        if (Option.isNone(found)) {
          return yield* twitchError(notConfigured);
        }

        // Only one sign-in listens at a time.
        yield* FiberHandle.clear(signInHandle);

        const scope = yield* Scope.make();
        const signInState = crypto.randomUUID();

        const code = yield* listenForCode(signInState).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );

        yield* FiberHandle.run(
          signInHandle,
          Deferred.await(code).pipe(
            Effect.timeoutOrElse({
              duration: signInTimeout,
              orElse: () => Effect.fail(twitchError("sign-in timed out")),
            }),
            Effect.flatMap((code) =>
              exchangeCode(found.value, { code, redirectUri }).pipe(
                provideHttp,
              ),
            ),
            Effect.flatMap(saveTokens),
            Effect.andThen(Effect.logInfo("Signed in to Twitch")),
            Effect.andThen(requestRestart),
            Effect.andThen(desktop.notify({ title: "Signed in to Twitch" })),
            Effect.catch((error) =>
              Effect.logWarning("Twitch sign-in failed", error.message).pipe(
                Effect.andThen(
                  desktop.notify({
                    title: "Twitch sign-in failed",
                    body: error.message,
                  }),
                ),
              ),
            ),
            Effect.ensuring(Scope.close(scope, Exit.void)),
          ),
        );

        const url = authorizeUrl({
          clientId: found.value.clientId,
          redirectUri,
          state: signInState,
        });

        yield* desktop.open(url);

        return url;
      }).pipe(Effect.withSpan("TwitchSource.signIn"));

      const toSourceError = (error: { readonly message: string }) =>
        twitchError(error.message);

      const addChannel = Effect.fn("TwitchSource.addChannel")(function* (
        name: string,
        open: Option.Option<boolean>,
      ) {
        const session = yield* Ref.get(current);

        // Uses Twitch's spelling of the login when signed in, and refuses
        // channels that don't exist.
        const login = yield* Option.match(session, {
          onNone: () => Effect.succeed(loginKey(name)),
          onSome: ({ client }) =>
            client.users([loginKey(name)]).pipe(
              Effect.mapError(toSourceError),
              Effect.flatMap((users) =>
                Option.match(Arr.head(users), {
                  onNone: () =>
                    Effect.fail(
                      twitchError(`There's no Twitch channel called ${name}`),
                    ),
                  onSome: (user) => Effect.succeed(user.login),
                }),
              ),
            ),
        });

        const channels = yield* config.channels.pipe(
          Effect.mapError(toSourceError),
        );

        const twitch = Option.match(
          Arr.findFirstIndex(
            channels.twitch,
            (channel) => loginKey(channel.name) === login,
          ),
          {
            onNone: () =>
              Arr.append(channels.twitch, {
                name: login,
                open: Option.getOrElse(open, () => false),
              }),
            onSome: (index) =>
              Arr.map(channels.twitch, (channel, at) =>
                at === index
                  ? {
                      ...channel,
                      open: Option.getOrElse(open, () => channel.open),
                    }
                  : channel,
              ),
          },
        );

        yield* config
          .saveChannels({ ...channels, twitch })
          .pipe(Effect.mapError(toSourceError));

        yield* requestRestart;
      });

      const removeChannel = Effect.fn("TwitchSource.removeChannel")(function* (
        name: string,
      ) {
        const channels = yield* config.channels.pipe(
          Effect.mapError(toSourceError),
        );

        const twitch = Arr.filter(
          channels.twitch,
          (channel) => loginKey(channel.name) !== loginKey(name),
        );

        if (twitch.length === channels.twitch.length) {
          return yield* twitchError(`${name} isn't in channels.yml`);
        }

        yield* config
          .saveChannels({ ...channels, twitch })
          .pipe(Effect.mapError(toSourceError));

        yield* requestRestart;
      });

      return TwitchSource.of({ recheck, signIn, addChannel, removeChannel });
    }),
  );
}
