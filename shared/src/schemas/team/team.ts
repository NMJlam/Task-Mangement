import { z } from "zod";

/**
 * Team shapes for the R5 team endpoints. Mirrors the `team` table
 * (`backend/src/db/schema/team.ts`) column for column, so a bare `.select()`
 * satisfies `teamSchema` without a projection step.
 *
 * A team is a FLAT grouping of work — Exec, Media, Marketing, Sponsorship,
 * Events. It carries no rank and no authority; `lead` is a single column, not a
 * second role system. A lead's authority comes from their tier.
 */
const nameSchema = z.string().trim().min(1, "Team name is required").max(100);

export const teamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  // Nullable, and SET NULL on the member's removal: a team without a lead is a
  // normal state, not a broken one.
  lead: z.uuid().nullable(),
  createdAt: z.coerce.date(),
});

export type Team = z.infer<typeof teamSchema>;

/**
 * Every team read carries its members.
 *
 * Five teams and twenty members make a second round trip pure cost, and two
 * endpoints reporting the same fact are two facts able to disagree — which is
 * why there is no `GET /api/teams/:teamId/members`. Names come from the roster
 * (`GET /api/members`), which the caller already needs for the assignee picker.
 */
export const teamWithMembersSchema = teamSchema.extend({
  memberIds: z.array(z.uuid()),
});

export type TeamWithMembers = z.infer<typeof teamWithMembersSchema>;

/** Route params for every /teams/:id endpoint. */
export const teamParamsSchema = z.object({ id: z.uuid() });

/**
 * Route params for the staffing endpoints. The two ids MUST have different
 * names — Express cannot carry two `:id` params in one path.
 */
export const teamMemberParamsSchema = z.object({ teamId: z.uuid(), userId: z.uuid() });

// ── GET /api/teams ───────────────────────────────────────────────────────────

/**
 * `member` answers "which teams am I in" — the sidebar read that
 * `team_member_user_idx` exists to serve. No pagination: the committee has five
 * teams, and a `limit` nobody can reach is a parameter nobody maintains.
 */
export const listTeamsQuerySchema = z.object({ member: z.uuid().optional() });

export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;

// ── POST /api/teams ──────────────────────────────────────────────────────────

/**
 * `lead` is optional and is NOT required to be a member of the team — the table
 * has no such constraint, so neither does this.
 */
export const createTeamSchema = z.object({
  name: nameSchema,
  lead: z.uuid().nullish(),
});

export type CreateTeam = z.infer<typeof createTeamSchema>;

// ── PATCH /api/teams/:id ─────────────────────────────────────────────────────

/**
 * Every field optional, but at least one must be present — an empty patch is a
 * client bug, not a no-op (same rule as `updateTaskSchema`).
 */
export const updateTeamSchema = z
  .object({
    name: nameSchema.optional(),
    lead: z.uuid().nullish(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateTeam = z.infer<typeof updateTeamSchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const teamResponseSchema = z.object({ team: teamWithMembersSchema });
export const teamListResponseSchema = z.object({ teams: z.array(teamWithMembersSchema) });

export type TeamResponse = z.infer<typeof teamResponseSchema>;
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;
