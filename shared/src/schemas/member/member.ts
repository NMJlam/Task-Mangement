import { z } from "zod";
import { roleSchema, tierSchema } from "../role/role.js";

export const memberSchema = z.object({
  id: z.uuid(),
  role: roleSchema,
  tier: tierSchema,
  createdAt: z.coerce.date(),
});

export type Member = z.infer<typeof memberSchema>;

/** Route params for every /members/:id endpoint. */
export const memberParamsSchema = z.object({ id: z.uuid() });

export const changeMemberRoleParamsSchema = memberParamsSchema;
export const changeMemberRoleSchema = z.object({ role: roleSchema });
export const changeMemberRoleResponseSchema = z.object({ member: memberSchema });

export type ChangeMemberRole = z.infer<typeof changeMemberRoleSchema>;
export type ChangeMemberRoleResponse = z.infer<typeof changeMemberRoleResponseSchema>;

// ── GET /api/members ─────────────────────────────────────────────────────────

/**
 * The roster row. `memberSchema` is the `app_user` table; this is that table
 * joined to the two facts it deliberately does not store.
 *
 * `name`/`email` live in Better Auth's `auth.user` — `app_user` is the
 * MEMBERSHIP record and duplicating identity there would be a second copy able
 * to drift.
 *
 * `portfolio` is DERIVED, never stored: the team this member is `lead` of.
 * "Marketing Director" means the director who leads Marketing, so encoding a
 * portfolio in the role would fuse the two hierarchies the design keeps apart.
 * A director who leads no team has no portfolio — an accepted gap.
 */
export const rosterMemberSchema = memberSchema.extend({
  name: z.string(),
  email: z.string(),
  teamIds: z.array(z.uuid()),
  portfolio: z.string().nullable(),
});

export type RosterMember = z.infer<typeof rosterMemberSchema>;

export const memberListResponseSchema = z.object({ members: z.array(rosterMemberSchema) });

export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

// ── DELETE /api/members/:id ──────────────────────────────────────────────────

/**
 * `reassignTo` is the handover target for the departing member's open tasks.
 * Optional in the schema, but the route rejects a removal that would strand
 * open work (rule 7) — `task.assignee` is ON DELETE SET NULL, so the database
 * will happily orphan them.
 */
export const removeMemberQuerySchema = z.object({ reassignTo: z.uuid().optional() });

export type RemoveMemberQuery = z.infer<typeof removeMemberQuerySchema>;
