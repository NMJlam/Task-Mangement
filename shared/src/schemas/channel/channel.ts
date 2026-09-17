import { z } from "zod";

/**
 * Channel kind, which decides WHICH of the two visibility mechanisms applies:
 *
 *   team, event    → min_tier: everyone at that tier or above
 *   group, dm, ai  → membership: a chan_member row is required
 *
 * Mixing them makes both incoherent, so a CHECK constraint forbids setting
 * min_tier on a membership-gated channel. A private management channel is a `group`;
 * "directors and up" is a `team` channel with min_tier = 1.
 */
export const channelKindSchema = z.enum(["team", "event", "group", "dm", "ai"]);

export type ChannelKind = z.infer<typeof channelKindSchema>;
