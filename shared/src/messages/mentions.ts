/**
 * The one @mention rule both sides share, like `tasks/order.ts` (§1.2): pure,
 * no React, no Express, no db, so the backend and the composer cannot drift
 * on what counts as a mention.
 *
 * A mention is stored as `@[user-id]` in the message body — a user id, not a
 * display name, because names aren't unique and change on rename (see
 * `backend/src/db/schema/message.ts`). Rendering the friendly name back is the
 * frontend's job, done against the already-loaded roster; this file only
 * knows how to find and build the token itself.
 */

const MENTION_PATTERN = /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

/** The token to insert when a composer's autocomplete picks someone. */
export function mentionToken(userId: string): string {
  return `@[${userId}]`;
}

/**
 * Every id mentioned in `body`, once each, in the order first mentioned. A
 * malformed or truncated token (not a UUID between the brackets) is not a
 * mention — it is silently ignored rather than treated as a broken one, the
 * same way `insertAfter` treats a stale anchor as "append" rather than an
 * error: free text a person typed should never be able to crash a route.
 */
export function extractMentionedIds(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    seen.add(match[1]!.toLowerCase());
  }
  return [...seen];
}

export type MentionPart = string | { userId: string };

/**
 * `body`, split into plain-text runs and mention markers, in order — what a
 * renderer walks to turn each token into "@Display Name" (resolved against
 * the roster it already has) without knowing the token's own format. Shares
 * `MENTION_PATTERN` with `extractMentionedIds` so the two can never disagree
 * on what counts as a mention.
 */
export function splitMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const index = match.index!;
    if (index > lastIndex) parts.push(body.slice(lastIndex, index));
    parts.push({ userId: match[1]!.toLowerCase() });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}
