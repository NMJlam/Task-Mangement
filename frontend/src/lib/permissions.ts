import type { AuthUser } from "@ctp/shared";

/**
 * Who may edit an event — the owner, or any lead and above.
 *
 * The rule is the SERVER's, spelled out at the owner check in
 * `backend/src/routes/events/events.ts` (`req.user.tier < 1 && event.owner !==
 * req.user.id` → 403). It lives here as one function because the UI needs it in
 * two places — the event page's header and the calendar's chips and preview — and
 * a second copy of a permission rule is how a control appears to someone the API
 * will refuse.
 *
 * `ownerId` is nullable: an event with no owner is editable by tier 1 and up
 * alone, which is what the server does with `null !== req.user.id`.
 */
export function canEditEvent(user: AuthUser | undefined, ownerId: string | null): boolean {
  if (!user) return false;
  return user.tier >= 1 || (ownerId !== null && ownerId === user.id);
}
