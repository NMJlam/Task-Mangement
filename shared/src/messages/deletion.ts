import { can } from "../auth/capabilities.js";
import type { ChannelKind } from "../schemas/channel/channel.js";
import type { Role } from "../schemas/role/role.js";

/**
 * Who may delete a message or a group — the named-office rules both sides
 * share, like `auth/capabilities.ts`: the UI asks them to decide which controls
 * to draw, the API asks them again before it writes.
 *
 * Every argument is a fact the CALLER must already trust: the backend reads the
 * author, creator and membership from the database under a row lock, never
 * from the request. These functions only combine those facts; they do not
 * decide whether the thread is visible or writable. That stays with
 * `visibleThreads` and the archive rule, which run first.
 */

export interface DeletingViewer {
  id: string;
  role: Role;
}

/**
 * Why `viewer` may delete `message`, or `undefined` when they may not. The
 * author's own claim wins over moderation, so the audit trail records a
 * president deleting their own message as "author", not "moderator".
 */
export function messageDeletionAuthority(
  viewer: DeletingViewer,
  message: { author: string | null },
): "author" | "moderator" | undefined {
  if (message.author !== null && message.author === viewer.id) return "author";
  if (can(viewer.role, "message:delete-any")) return "moderator";
  return undefined;
}

/**
 * Why `viewer` may delete a group for everyone, or `undefined`.
 *
 * Membership comes first: neither power reaches a group the caller is not in.
 * Only a custom group is deletable — a dm belongs to both people, and team and
 * event threads follow their team or event. A group opened before creators
 * were recorded has `createdBy` null, which no current member can claim as creator.
 */
export function groupDeletionAuthority(
  viewer: DeletingViewer,
  group: { kind: ChannelKind; createdBy: string | null; isMember: boolean },
): "president" | "creator" | undefined {
  if (group.kind !== "group" || !group.isMember) return undefined;
  if (can(viewer.role, "group:delete-any")) return "president";
  if (
    can(viewer.role, "group:delete-created") &&
    group.createdBy !== null &&
    group.createdBy === viewer.id
  ) {
    return "creator";
  }
  return undefined;
}

export function canDeleteMessage(
  viewer: DeletingViewer,
  message: { author: string | null },
): boolean {
  return messageDeletionAuthority(viewer, message) !== undefined;
}

export function canDeleteGroup(
  viewer: DeletingViewer,
  group: { kind: ChannelKind; createdBy: string | null; isMember: boolean },
): boolean {
  return groupDeletionAuthority(viewer, group) !== undefined;
}
