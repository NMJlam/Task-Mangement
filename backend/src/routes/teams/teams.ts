import {
  createTeamSchema,
  listTeamsQuerySchema,
  teamMemberParamsSchema,
  teamParamsSchema,
  updateTeamSchema,
  type CreateTeam,
  type ListTeamsQuery,
  type TeamListResponse,
  type TeamResponse,
  type TeamWithMembers,
  type UpdateTeam,
} from "@ctp/shared";
import { and, asc, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, teamMembers, teams } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const teamsRouter = Router();

/**
 * Team CRUD and staffing (R5).
 *
 * Tier gates only — no new entry in `CAPABILITIES`. Team management is bound to
 * rank, not to a named office, and that map is the source of the role-diff UI:
 * it should only grow when a power is genuinely role-bound (plan.md watch-out 4,
 * the same call `tasks.ts` made).
 *
 *   tier 0  read
 *   tier 1  staff a team you LEAD
 *   tier 2  create, rename, re-lead, delete
 */

const MANAGEMENT_TIER = 2;

/**
 * `pg` puts the SQLSTATE on `error.code` and Drizzle re-throws it untouched.
 * Two of them are ordinary outcomes here, not failures, so they get translated
 * rather than reaching the 500 handler.
 */
function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function teamNotFound(res: Response): void {
  res.status(404).json({ error: { code: "TEAM_NOT_FOUND", message: "Team not found." } });
}

function nameTaken(res: Response): void {
  res
    .status(409)
    .json({ error: { code: "TEAM_NAME_TAKEN", message: "A team with that name already exists." } });
}

function unknownReference(res: Response, field: "lead" | "userId"): void {
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      fields: { [field]: ["No member with that id"] },
    },
  });
}

/**
 * `lead` is FK-constrained, so an unknown id would otherwise surface as an
 * opaque 500. Resolving it here turns it into a 422 that names the field.
 *
 * Deliberately not shared with the equivalent in `tasks.ts`: two callers with
 * different shapes do not justify a module. Lift both into `db/references.ts`
 * when a third appears.
 */
async function leadIsMissing(lead: string | null | undefined): Promise<boolean> {
  if (typeof lead !== "string") return false;
  const [found] = await getDb()
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, lead))
    .limit(1);
  return !found;
}

/** A team plus its members — the one shape every team read returns. */
function withMembers(
  team: typeof teams.$inferSelect,
  links: (typeof teamMembers.$inferSelect)[],
): TeamWithMembers {
  return {
    ...team,
    memberIds: links.filter((link) => link.teamId === team.id).map((link) => link.userId),
  };
}

/**
 * The staffing gate: tier 2 staffs any team, tier 1 only a team they lead.
 * Resolves the team while it is at it, since both callers need it anyway.
 */
async function resolveTeamForStaffing(
  teamId: string,
  actor: { id: string; tier: number },
  res: Response,
): Promise<typeof teams.$inferSelect | undefined> {
  const [team] = await getDb().select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    teamNotFound(res);
    return undefined;
  }
  if (actor.tier < MANAGEMENT_TIER && team.lead !== actor.id) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not lead this team." } });
    return undefined;
  }
  return team;
}

// ── GET /api/teams ───────────────────────────────────────────────────────────

teamsRouter.get(
  "/teams",
  authenticate,
  authorise(0),
  validate(listTeamsQuerySchema, "query"),
  async (_req, res, next) => {
    try {
      const query = res.locals.validated as ListTeamsQuery;
      const db = getDb();
      // Two unfiltered reads joined in memory. At five teams and twenty members
      // that is cheaper than a grouped query and far easier to read, and it
      // serves both the roster page and the sidebar from one round trip.
      // ponytail: whole-table read, add a WHERE once the club outgrows a page.
      const [rows, links] = await Promise.all([
        db.select().from(teams).orderBy(asc(teams.name)),
        db.select().from(teamMembers),
      ]);

      const list = rows
        .map((team) => withMembers(team, links))
        .filter((team) => !query.member || team.memberIds.includes(query.member));

      res.status(200).json({ teams: list } satisfies TeamListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/teams ──────────────────────────────────────────────────────────

teamsRouter.post(
  "/teams",
  authenticate,
  authorise(MANAGEMENT_TIER),
  validate(createTeamSchema),
  async (_req, res, next) => {
    try {
      const input = res.locals.validated as CreateTeam;
      if (await leadIsMissing(input.lead)) {
        unknownReference(res, "lead");
        return;
      }

      const [team] = await getDb()
        .insert(teams)
        .values({ id: newId(), ...input })
        .returning();

      res.status(201).json({ team: withMembers(team!, []) } satisfies TeamResponse);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        nameTaken(res);
        return;
      }
      next(error);
    }
  },
);

// ── PATCH /api/teams/:id ─────────────────────────────────────────────────────

teamsRouter.patch(
  "/teams/:id",
  authenticate,
  authorise(MANAGEMENT_TIER),
  validate(teamParamsSchema, "params"),
  validate(updateTeamSchema),
  async (req, res, next) => {
    try {
      const patch = res.locals.validated as UpdateTeam;
      if (await leadIsMissing(patch.lead)) {
        unknownReference(res, "lead");
        return;
      }

      const db = getDb();
      const [team] = await db
        .update(teams)
        .set(patch)
        .where(eq(teams.id, req.params.id!))
        .returning();

      if (!team) {
        teamNotFound(res);
        return;
      }
      const links = await db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
      res.status(200).json({ team: withMembers(team, links) } satisfies TeamResponse);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        nameTaken(res);
        return;
      }
      next(error);
    }
  },
);

// ── DELETE /api/teams/:id ────────────────────────────────────────────────────

teamsRouter.delete(
  "/teams/:id",
  authenticate,
  authorise(MANAGEMENT_TIER),
  validate(teamParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const [team] = await getDb()
        .delete(teams)
        .where(eq(teams.id, req.params.id!))
        .returning({ id: teams.id });

      if (!team) {
        teamNotFound(res);
        return;
      }
      res.status(204).end();
    } catch (error) {
      // workstream.team_id and expense.team_id are ON DELETE RESTRICT: losing
      // spend-by-team for a past period is not a delete anyone meant to make.
      if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
        res.status(409).json({
          error: {
            code: "TEAM_IN_USE",
            message:
              "This team has workstreams or recorded spend and cannot be deleted. Rename it instead.",
          },
        });
        return;
      }
      next(error);
    }
  },
);

// ── PUT /api/teams/:teamId/members/:userId ───────────────────────────────────

teamsRouter.put(
  "/teams/:teamId/members/:userId",
  authenticate,
  authorise(1),
  validate(teamMemberParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const teamId = req.params.teamId!;
      if (!(await resolveTeamForStaffing(teamId, req.user!, res))) return;

      // Idempotent: re-adding a member is a double-click, not an error.
      await getDb()
        .insert(teamMembers)
        .values({ teamId, userId: req.params.userId! })
        .onConflictDoNothing();
      res.status(204).end();
    } catch (error) {
      if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
        unknownReference(res, "userId");
        return;
      }
      next(error);
    }
  },
);

// ── DELETE /api/teams/:teamId/members/:userId ────────────────────────────────

teamsRouter.delete(
  "/teams/:teamId/members/:userId",
  authenticate,
  authorise(1),
  validate(teamMemberParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const teamId = req.params.teamId!;
      if (!(await resolveTeamForStaffing(teamId, req.user!, res))) return;

      // Also idempotent — removing someone who was never on the team leaves the
      // caller with exactly the state they asked for.
      await getDb()
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.params.userId!)));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
