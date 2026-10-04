import {
  Array as Arr,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  HashMap,
  HashSet,
  Layer,
  Context,
  Option,
  Predicate,
  Queue,
  Redacted,
  Ref,
  Result,
  Scope,
  Semaphore,
  Stream,
  String as Str,
} from "effect";
import { HttpClient } from "effect/http";
import type { MediaKind } from "@timmo001/effect-upnext-shared";
import {
  authorizeUrl,
  exchangeCode,
  type FeedEntry,
  type GoogleTokens,
  make as makeYouTubeClient,
  refreshTokens,
  type Subscription,
  toMediaItem,
  type VideoDetails,
  YouTubeAuthError,
} from "@timmo001/effect-youtube";
import {
  type ChannelCandidate,
  type FeedItem,
  SourceError,
  type SourceStatus,
} from "@timmo001/effect-upnext";
import { UpnextConfig } from "../config/Config.js";
import { Desktop } from "../desktop/Desktop.js";
import { FeedStore } from "../feed/Feed.js";
import { UpnextState } from "../state/State.js";
import { candidateOrder } from "./candidates.js";
import { listenForCode, youtubeSignIn } from "./signIn.js";
import { wakeups } from "./wakeups.js";

// Uploads older than this drop out of the feed.
const uploadWindow = Duration.days(7);

// A scheduled stream this far past its start that still isn't live has been
// abandoned. YouTube keeps listing those as upcoming.
const upcomingGrace = Duration.hours(2);

const feedConcurrency = 4;

const signInTimeout = Duration.minutes(5);

// Refresh the access token this long before it expires.
const refreshMargin = Duration.minutes(1);

const noApiKey = "Set youtube.api_key to see live and upcoming streams";

const noChannels = "Add YouTube channels to channels.yml";

const noGoogleClient =
  "Set youtube.client_id and youtube.client_secret to sign in";

const signInMessage = "Run upnext auth youtube to see your subscriptions";

const youtubeError = (message: string) =>
  new SourceError({ source: "youtube", message });

// Accepts a channel ID or a /channel/<ID> URL.
const channelIdFrom = (value: string) => {
  const trimmed = Str.trim(value);

  return Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(/\/channel\/([\w-]+)/.exec(trimmed)),
      (match) => Option.fromNullishOr(match[1]),
    ),
    () => trimmed,
  );
};

export interface YouTubeSourceService {
  // Checks now. With `open`, opens every live stream set to auto-open.
  readonly recheck: (open: boolean) => Effect.Effect<void, SourceError>;
  // Starts signing in to Google and returns the page to open.
  readonly signIn: Effect.Effect<string, SourceError>;
  // Subscriptions that aren't in channels.yml.
  readonly candidates: Effect.Effect<
    ReadonlyArray<ChannelCandidate>,
    SourceError
  >;
  readonly addChannel: (
    id: string,
    open: Option.Option<boolean>,
  ) => Effect.Effect<void, SourceError>;
  readonly removeChannel: (id: string) => Effect.Effect<void, SourceError>;
}

export class YouTubeSource extends Context.Service<
  YouTubeSource,
  YouTubeSourceService
>()("YouTubeSource") {
  static readonly layer = Layer.effect(
    YouTubeSource,
    Effect.gen(function* () {
      const config = yield* UpnextConfig;
      const state = yield* UpnextState;
      const feed = yield* FeedStore;
      const desktop = yield* Desktop;
      const http = yield* HttpClient.HttpClient;
      const provideHttp = Effect.provideService(HttpClient.HttpClient, http);

      const checking = yield* Semaphore.make(1);
      const trigger = yield* Queue.sliding<void>(1);
      // False until the first check, which counts as startup.
      const started = yield* Ref.make(false);
      const signInHandle = yield* FiberHandle.make<void, never>();

      // The access token from the last refresh, kept until it nearly expires.
      const session = yield* Ref.make(Option.none<GoogleTokens>());

      // Channels read at least once. A channel's first read isn't announced,
      // so adding one doesn't announce a week of uploads.
      const knownChannels = yield* Ref.make(HashSet.empty<string>());

      const announce = ({ item }: FeedItem) =>
        desktop.notify({
          title:
            item.kind === "live"
              ? `${item.channel?.name ?? "A channel"} is live`
              : `New from ${item.channel?.name ?? "YouTube"}`,
          body: item.title,
          url: item.url,
          sound: true,
        });

      const storedRefreshToken = Effect.map(state.get, ({ youtube }) =>
        Option.map(
          Option.filter(
            Option.fromUndefinedOr(youtube?.refreshToken),
            Str.isNonEmpty,
          ),
          Redacted.make,
        ),
      );

      // None when not signed in to Google.
      const accessToken = Effect.gen(function* () {
        const { youtube } = yield* config.settings;
        const refreshToken = yield* storedRefreshToken;

        if (Option.isNone(youtube.google) || Option.isNone(refreshToken)) {
          return Option.none<Redacted.Redacted>();
        }

        const now = yield* DateTime.now;

        const cached = Option.filter(yield* Ref.get(session), ({ expiresAt }) =>
          DateTime.isGreaterThan(
            expiresAt,
            DateTime.addDuration(now, refreshMargin),
          ),
        );

        if (Option.isSome(cached)) {
          return Option.some(cached.value.accessToken);
        }

        const tokens = yield* refreshTokens(
          youtube.google.value,
          refreshToken.value,
        ).pipe(provideHttp);

        yield* Ref.set(session, Option.some(tokens));

        return Option.some(tokens.accessToken);
      });

      const check = (open: boolean) =>
        Effect.gen(function* () {
          const settings = yield* config.settings;
          const channels = (yield* config.channels).youtube;
          const now = yield* DateTime.now;

          const failureStatus = (error: {
            readonly _tag: string;
            readonly message: string;
          }): SourceStatus =>
            Predicate.isTagged(error, "YouTubeAuthError")
              ? {
                  source: "youtube",
                  state: "auth-required",
                  message: `${error.message}. Run upnext auth youtube to sign in again`,
                  checkedAt: now,
                }
              : {
                  source: "youtube",
                  state: "error",
                  message: error.message,
                  checkedAt: now,
                };

          const token = yield* Effect.result(accessToken);

          const signedIn = Result.getOrElse(token, () =>
            Option.none<Redacted.Redacted>(),
          );

          const client = yield* makeYouTubeClient({
            apiKey: settings.youtube.apiKey,
            accessToken: signedIn,
          }).pipe(provideHttp);

          const subscribed = Option.isSome(signedIn)
            ? yield* Effect.result(client.subscriptions)
            : Result.succeed<ReadonlyArray<Subscription>>([]);

          const authFailure = Result.isFailure(token)
            ? Option.some(failureStatus(token.failure))
            : Result.isFailure(subscribed)
              ? Option.some(failureStatus(subscribed.failure))
              : Option.none<SourceStatus>();

          const trackedChannels = HashMap.fromIterable(
            Arr.map(
              channels,
              ({ id, open }, position) => [id, { open, position }] as const,
            ),
          );

          // Channels in channels.yml, then other subscriptions.
          const targets = Arr.appendAll(
            Arr.map(channels, ({ id }) => id),
            Arr.filter(
              Arr.map(
                Result.getOrElse(subscribed, () => []),
                ({ channelId }) => channelId,
              ),
              (id) => !HashMap.has(trackedChannels, id),
            ),
          );

          if (Arr.isReadonlyArrayEmpty(targets)) {
            yield* feed.setSource(
              Option.getOrElse(authFailure, () => ({
                source: "youtube",
                state: "disabled",
                message: noChannels,
                checkedAt: now,
              })),
              [],
            );

            return;
          }

          const watched = HashSet.fromIterable(
            (yield* state.get).watched ?? [],
          );

          const before = Arr.filter(
            (yield* feed.get).items,
            ({ item }) => item.source === "youtube",
          );

          const results = yield* Effect.forEach(
            targets,
            (id) =>
              client.channelFeed(id).pipe(
                Effect.map((entries) => ({ id, entries })),
                Effect.result,
              ),
            { concurrency: feedConcurrency },
          );

          const failures = Arr.getFailures(results);
          const feeds = Arr.getSuccesses(results);

          const cutoff = DateTime.subtractDuration(now, uploadWindow);

          const isRecent = ({ publishedAt }: FeedEntry) =>
            DateTime.isGreaterThanOrEqualTo(publishedAt, cutoff);

          const abandonedBefore = DateTime.subtractDuration(now, upcomingGrace);

          // Only recent uploads from other subscriptions are looked up, so
          // a long subscription list stays within the daily API quota.
          const entries = Arr.filter(
            Arr.flatMap(feeds, ({ id, entries }) =>
              HashMap.has(trackedChannels, id)
                ? entries
                : Arr.filter(entries, isRecent),
            ),
            ({ videoId }) => !HashSet.has(watched, `youtube:${videoId}`),
          );

          const details = client.hasApiKey
            ? yield* client
                .videos(Arr.map(entries, ({ videoId }) => videoId))
                .pipe(Effect.result)
            : Result.succeed<ReadonlyArray<VideoDetails>>([]);

          const byId = HashMap.fromIterable(
            Arr.map(
              Result.getOrElse(details, () => []),
              (video) => [video.id, video] as const,
            ),
          );

          const fetched = Arr.filterMap(entries, (entry: FeedEntry) => {
            const item = toMediaItem(entry, HashMap.get(byId, entry.videoId));
            const channel = HashMap.get(trackedChannels, entry.channelId);

            const recent =
              item.kind === "upload"
                ? isRecent(entry)
                : item.kind === "live" ||
                  Option.match(Option.fromUndefinedOr(item.publishedAt), {
                    onNone: () => true,
                    onSome: (startsAt) =>
                      DateTime.isGreaterThanOrEqualTo(
                        startsAt,
                        abandonedBefore,
                      ),
                  });

            // Upcoming streams only show for channels in channels.yml.
            const shown =
              recent && (Option.isSome(channel) || item.kind !== "upcoming");

            return shown
              ? Result.succeed<FeedItem>(
                  Option.match(channel, {
                    onNone: () => ({ item, tracked: false, autoOpen: false }),
                    onSome: ({ open, position }) => ({
                      item,
                      tracked: true,
                      position,
                      autoOpen: open,
                    }),
                  }),
                )
              : Result.failVoid;
          });

          // A channel that failed this time keeps what it had, so its
          // uploads don't come back as new next time.
          const failedChannels = HashSet.fromIterable(
            Arr.filterMap(results, (result, index) =>
              Result.isFailure(result)
                ? Result.fromOption(Arr.get(targets, index), () => undefined)
                : Result.failVoid,
            ),
          );

          const kept = Arr.filter(before, ({ item }) =>
            HashSet.has(failedChannels, item.channel?.id ?? ""),
          );

          const items = Arr.appendAll(fetched, kept);

          const okStatus: SourceStatus =
            Option.isSome(settings.youtube.google) && Option.isNone(signedIn)
              ? {
                  source: "youtube",
                  state: "ok",
                  message: signInMessage,
                  checkedAt: now,
                }
              : client.hasApiKey
                ? { source: "youtube", state: "ok", checkedAt: now }
                : {
                    source: "youtube",
                    state: "ok",
                    message: noApiKey,
                    checkedAt: now,
                  };

          const status = Option.getOrElse(authFailure, () =>
            Arr.match(failures, {
              onEmpty: (): SourceStatus =>
                Result.isFailure(details)
                  ? {
                      source: "youtube",
                      state: "error",
                      message: details.failure.message,
                      checkedAt: now,
                    }
                  : okStatus,
              onNonEmpty: ([first]): SourceStatus => ({
                source: "youtube",
                state: "error",
                message: `Couldn't read ${failures.length} of ${targets.length} channels: ${first.message}`,
                checkedAt: now,
              }),
            }),
          );

          const previousKind = HashMap.fromIterable(
            Arr.map(before, ({ item }) => [item.id, item.kind] as const),
          );

          yield* feed.setSource(status, items);

          const startup = !(yield* Ref.getAndSet(started, true));

          const known = yield* Ref.getAndUpdate(knownChannels, (set) =>
            HashSet.union(
              set,
              HashSet.fromIterable(Arr.map(feeds, ({ id }) => id)),
            ),
          );

          // New items, and upcoming streams that have just gone live.
          const fresh = Arr.filter(fetched, ({ item }) =>
            Option.match(HashMap.get(previousKind, item.id), {
              onNone: () =>
                startup || HashSet.has(known, item.channel?.id ?? ""),
              onSome: (kind: MediaKind) =>
                item.kind === "live" && kind !== "live",
            }),
          );

          const isLive = ({ item }: FeedItem) => item.kind === "live";

          // Only channels in channels.yml are announced. At startup a week of
          // uploads is new, so only live streams are announced, and only when
          // notify_on_startup is set.
          const toAnnounce = Arr.filter(
            startup
              ? settings.notifyOnStartup
                ? Arr.filter(fresh, isLive)
                : []
              : Arr.filter(fresh, ({ item }) => item.kind !== "upcoming"),
            ({ tracked }) => tracked,
          );

          const toOpen = Arr.filter(
            open ? items : startup ? [] : fresh,
            (feedItem) => feedItem.autoOpen && isLive(feedItem),
          );

          yield* Effect.forEach(toAnnounce, announce, { discard: true });

          yield* Effect.forEach(toOpen, ({ item }) => desktop.open(item.url), {
            discard: true,
          });
        }).pipe(
          Effect.catchTags({
            ConfigError: (error) =>
              Effect.flatMap(DateTime.now, (checkedAt) =>
                feed.setStatus({
                  source: "youtube",
                  state: "error",
                  message: error.message,
                  checkedAt,
                }),
              ),
          }),
          Semaphore.withPermit(checking),
          Effect.withSpan("YouTubeSource.check"),
        );

      const requestCheck = Queue.offer(trigger, undefined).pipe(Effect.asVoid);

      // Checks, then waits for the poll interval or something that wants a
      // check sooner, such as a channel change or waking from sleep.
      yield* Effect.gen(function* () {
        yield* check(false);
        const { youtube } = yield* config.settings;

        yield* Queue.take(trigger).pipe(
          Effect.timeoutOrElse({
            duration: youtube.pollInterval,
            orElse: () => Effect.void,
          }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("YouTube check failed", cause).pipe(
            Effect.andThen(Effect.sleep(Duration.minutes(1))),
          ),
        ),
        Effect.forever,
        Effect.forkScoped,
      );

      yield* wakeups.pipe(
        Stream.runForEach(() => requestCheck),
        Effect.forkScoped,
      );

      const toSourceError = (error: { readonly message: string }) =>
        youtubeError(error.message);

      const saveTokens = Effect.fn("YouTubeSource.saveTokens")(function* (
        tokens: GoogleTokens,
      ) {
        if (Option.isNone(tokens.refreshToken)) {
          return yield* new YouTubeAuthError({
            message: "Google sent no refresh token",
          });
        }

        const refreshToken = Redacted.value(tokens.refreshToken.value);

        yield* state.update((previous) => ({
          ...previous,
          youtube: { refreshToken },
        }));

        yield* Ref.set(session, Option.some(tokens));
      });

      const signIn = Effect.gen(function* () {
        const settings = yield* config.settings.pipe(
          Effect.mapError(toSourceError),
        );

        if (Option.isNone(settings.youtube.google)) {
          return yield* youtubeError(noGoogleClient);
        }

        const google = settings.youtube.google.value;

        // Only one sign-in listens at a time.
        yield* FiberHandle.clear(signInHandle);

        const scope = yield* Scope.make();
        const signInState = crypto.randomUUID();

        const code = yield* listenForCode(youtubeSignIn, signInState).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );

        yield* FiberHandle.run(
          signInHandle,
          Deferred.await(code).pipe(
            Effect.timeoutOrElse({
              duration: signInTimeout,
              orElse: () => Effect.fail(youtubeError("sign-in timed out")),
            }),
            Effect.flatMap((code) =>
              exchangeCode(google, {
                code,
                redirectUri: youtubeSignIn.redirectUri,
              }).pipe(provideHttp),
            ),
            Effect.flatMap(saveTokens),
            Effect.andThen(Effect.logInfo("Signed in to Google")),
            Effect.andThen(requestCheck),
            Effect.andThen(desktop.notify({ title: "Signed in to Google" })),
            Effect.catch((error) =>
              Effect.logWarning("Google sign-in failed", error.message).pipe(
                Effect.andThen(
                  desktop.notify({
                    title: "Google sign-in failed",
                    body: error.message,
                  }),
                ),
              ),
            ),
            Effect.ensuring(Scope.close(scope, Exit.void)),
          ),
        );

        const url = authorizeUrl({
          clientId: google.clientId,
          redirectUri: youtubeSignIn.redirectUri,
          state: signInState,
        });

        yield* desktop.open(url);

        return url;
      }).pipe(Effect.withSpan("YouTubeSource.signIn"));

      const candidates = Effect.gen(function* () {
        const token = yield* accessToken;

        if (Option.isNone(token)) {
          return yield* youtubeError(signInMessage);
        }

        const client = yield* makeYouTubeClient({
          apiKey: Option.none(),
          accessToken: token,
        }).pipe(provideHttp);

        const subscriptions = yield* client.subscriptions;

        const tracked = HashSet.fromIterable(
          Arr.map((yield* config.channels).youtube, ({ id }) => id),
        );

        return Arr.sort(
          Arr.filterMap(subscriptions, ({ channelId, title }) =>
            HashSet.has(tracked, channelId)
              ? Result.failVoid
              : Result.succeed<ChannelCandidate>({ name: channelId, title }),
          ),
          candidateOrder,
        );
      }).pipe(
        Effect.mapError(toSourceError),
        Effect.withSpan("YouTubeSource.candidates"),
      );

      const addChannel = Effect.fn("YouTubeSource.addChannel")(function* (
        value: string,
        open: Option.Option<boolean>,
      ) {
        const id = channelIdFrom(value);

        const settings = yield* config.settings.pipe(
          Effect.mapError(toSourceError),
        );

        const client = yield* makeYouTubeClient({
          apiKey: settings.youtube.apiKey,
        }).pipe(provideHttp);

        yield* client
          .channelFeed(id)
          .pipe(
            Effect.mapError((error) =>
              youtubeError(
                error.status === 404
                  ? `There's no YouTube channel with the ID ${id}. Use the ID that starts with UC, not a handle.`
                  : error.message,
              ),
            ),
          );

        yield* config
          .updateChannels((channels) =>
            Effect.succeed({
              ...channels,
              youtube: Option.match(
                Arr.findFirstIndex(
                  channels.youtube,
                  (channel) => channel.id === id,
                ),
                {
                  onNone: () =>
                    Arr.append(channels.youtube, {
                      id,
                      open: Option.getOrElse(open, () => false),
                    }),
                  onSome: (index) =>
                    Arr.map(channels.youtube, (channel, at) =>
                      at === index
                        ? {
                            ...channel,
                            open: Option.getOrElse(open, () => channel.open),
                          }
                        : channel,
                    ),
                },
              ),
            }),
          )
          .pipe(Effect.mapError(toSourceError));

        yield* requestCheck;
      });

      const removeChannel = Effect.fn("YouTubeSource.removeChannel")(function* (
        value: string,
      ) {
        const id = channelIdFrom(value);

        yield* config
          .updateChannels((channels) => {
            const youtube = Arr.filter(
              channels.youtube,
              (channel) => channel.id !== id,
            );

            return youtube.length === channels.youtube.length
              ? Effect.fail(youtubeError(`${id} isn't in channels.yml`))
              : Effect.succeed({ ...channels, youtube });
          })
          .pipe(Effect.mapError(toSourceError));

        yield* requestCheck;
      });

      return YouTubeSource.of({
        recheck: check,
        signIn,
        candidates,
        addChannel,
        removeChannel,
      });
    }),
  );
}
