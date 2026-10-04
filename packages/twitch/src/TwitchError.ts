import { Schema } from "effect";

// A Twitch request failed. Messages never include response bodies, so tokens
// can't leak into logs.
export class TwitchError extends Schema.TaggedError<TwitchError>()(
  "TwitchError",
  { message: Schema.String, status: Schema.optional(Schema.Finite) },
) {}

// The stored sign-in no longer works, and someone has to sign in again.
export class TwitchAuthError extends Schema.TaggedError<TwitchAuthError>()(
  "TwitchAuthError",
  { message: Schema.String },
) {}
