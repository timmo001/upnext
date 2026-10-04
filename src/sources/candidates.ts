import { Order, String as Str } from "effect";
import type { ChannelCandidate } from "@timmo001/effect-upnext";

// Candidates for the add prompt, alphabetical by name.
export const candidateOrder = Order.mapInput(
  Order.String,
  ({ title }: ChannelCandidate) => Str.toLowerCase(title),
);
