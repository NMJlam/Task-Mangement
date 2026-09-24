/**
 * The one renumber rule for a board column.
 *
 * Pure on purpose (§1.2 keeps this folder free of React, Express and db), so
 * the status endpoint and the board both call it and cannot drift apart: the
 * endpoint renumbers the stored column, the board renumbers the same ids
 * optimistically, and both place a card the same way.
 */

/**
 * `ids` — a column's card ids in reading order — with `movedId` placed directly
 * after `afterId`, or at the top when `afterId` is `null`.
 *
 * An anchor that is not in this column (a stale client, or a card that has
 * since moved away) appends, which is the same place as "after the last card".
 * Silently moving the card to the top would be the one wrong answer: it looks
 * like a drop the user did not make.
 *
 * A `movedId` already present is removed before it is reinserted, so a
 * same-column move can never duplicate the card or lose it.
 */
export function insertAfter(
  ids: readonly string[],
  movedId: string,
  afterId: string | null,
): string[] {
  const rest = ids.filter((id) => id !== movedId);
  if (afterId === null) return [movedId, ...rest];
  const anchor = rest.indexOf(afterId);
  if (anchor === -1) return [...rest, movedId];
  return [...rest.slice(0, anchor + 1), movedId, ...rest.slice(anchor + 1)];
}
