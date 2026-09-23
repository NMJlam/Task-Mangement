import type { Notification } from "@ctp/shared";

/**
 * Where a notification points.
 *
 * `entityType`/`entityId` have been on the row since the table was built and the
 * schema describes them as "a deep-link target with no FK (one table serves
 * every entity type)" — but nothing ever rendered the link, so every
 * notification was a dead end that named a task it could not open.
 *
 * The pair travels together (`notification_entity_all_or_nothing_check`), so one
 * guard covers both. An unknown `entityType` returns `undefined` rather than
 * guessing a route: the column is free text with no FK, and a link to a page
 * that cannot show the thing is worse than plain text.
 */
export function notificationLink(notification: Notification): string | undefined {
  const { entityType, entityId } = notification;
  if (!entityType || !entityId) return undefined;

  switch (entityType) {
    case "event":
      return `/events/${entityId}`;
    // The three below reach the right PAGE but cannot address the row, so the id
    // is deliberately NOT put in the URL: the board has no per-task route,
    // `/finance` has no per-expense route, and the id on a `message` row is the
    // message while `/messages` selects by thread. A `?task=` that nothing reads
    // is worse than no parameter — it looks like a working deep link and
    // silently isn't. Each becomes a one-line change here once its page can
    // take an id.
    case "task":
      return "/tasks";
    case "expense":
      return "/finance";
    case "message":
      return "/messages";
    default:
      return undefined;
  }
}
