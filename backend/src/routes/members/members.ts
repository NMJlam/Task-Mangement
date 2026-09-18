import {
  changeMemberRoleParamsSchema,
  changeMemberRoleSchema,
  can,
  memberParamsSchema,
  removeMemberQuerySchema,
  tierForRole,
  type ChangeMemberRole,
  type ChangeMemberRoleResponse,
  type Member,
  type MemberListResponse,
  type RemoveMemberQuery,
} from "@ctp/shared";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import {
  appUsers,
  authUser,
  taskAssignees,
  tasks,
  teamMembers,
  teams,
} from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const membersRouter = Router();

// ── GET /api/members ─────────────────────────────────────────────────────────

/**
 * Identity comes from `auth.user` in RAW SQL, not through Drizzle.
 *
 * The obvious move is to add `name`/`email` to the read-only `authUser`
 * declaration in `schema/auth.ts` — don't. `schemaFilter: ["public"]` stops
 * drizzle-kit CREATE/DROPing the auth tables, but it still diffs COLUMNS on a
 * table we declare, so `db:generate` emits `ALTER TABLE auth."user" ADD COLUMN
 * "name"` — against columns Better Auth already created. That migration fails on
 * every database it touches. Verified, then reverted.
 *
 * So the declaration stays at `id` (all the `app_user` FK needs) and the two
 * columns are read here, the same way the role-change CTE below reaches into
 * `auth` and `invite`.
 */
async function readIdentities(
  db: ReturnType<typeof getDb>,
): Promise<{ id: string; name: string; email: string }[]> {
  const result = await db.execute<{ id: string; name: string; email: string }>(
    sql`SELECT "id", "name", "email" FROM auth."user"`,
  );
  return [...result.rows];
}

membersRouter.get("/members", authenticate, authorise(0), async (_req, res, next) => {
  try {
    const db = getDb();
    // Four unfiltered reads joined in memory rather than one aggregate query:
    // twenty members, five teams and a hundred link rows make the grouped SQL
    // pure ceremony. `app_user` deliberately stores neither name nor email, so
    // the roster is the join that puts identity back together.
    // ponytail: whole-table reads, revisit if the committee outgrows a page.
    const [rows, identities, links, teamRows] = await Promise.all([
      db
        .select({
          id: appUsers.id,
          role: appUsers.role,
          tier: appUsers.tier,
          authUserId: appUsers.authUserId,
          createdAt: appUsers.createdAt,
        })
        .from(appUsers)
        .orderBy(desc(appUsers.tier), asc(appUsers.createdAt)),
      readIdentities(db),
      db.select().from(teamMembers),
      db.select({ id: teams.id, name: teams.name, lead: teams.lead }).from(teams),
    ]);

    const members = rows.map(({ authUserId, ...row }) => {
      const identity = identities.find((candidate) => candidate.id === authUserId);
      return {
        ...row,
        // An app_user without an auth user cannot exist — the FK is RESTRICT —
        // but the roster should degrade rather than 500 if one ever does.
        name: identity?.name ?? "",
        email: identity?.email ?? "",
        teamIds: links.filter((link) => link.userId === row.id).map((link) => link.teamId),
        // Derived, never stored: "Marketing Director" is the director who leads
        // Marketing. A director who leads no team has no portfolio — accepted.
        portfolio: teamRows.find((team) => team.lead === row.id)?.name ?? null,
      };
    });

    res.status(200).json({ members } satisfies MemberListResponse);
  } catch (error) {
    next(error);
  }
});

// ── PATCH /api/members/:id/role ──────────────────────────────────────────────

membersRouter.patch(
  "/members/:id/role",
  authenticate,
  authorise(1),
  validate(changeMemberRoleParamsSchema, "params"),
  validate(changeMemberRoleSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const input = res.locals.validated as ChangeMemberRole;
      const targetId = req.params.id!;
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, targetId)).limit(1);

      if (!target) {
        res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member not found." } });
        return;
      }
      if (tierForRole(input.role) > req.user!.tier || target.tier > req.user!.tier) {
        res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Role change exceeds your tier." } });
        return;
      }
      if (!can(req.user!.role, "member:role-change")) {
        res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Role cannot change members." } });
        return;
      }
      if (target.role === input.role) {
        res.status(200).json({ member: target } satisfies ChangeMemberRoleResponse);
        return;
      }
      const result = await db.execute<Member>(sql`
      WITH locked AS MATERIALIZED (
        SELECT id FROM "app_user"
        WHERE "role" = ${target.role}
        FOR UPDATE
      )
      UPDATE "app_user"
      SET "role" = ${input.role}
      WHERE "id" = ${target.id}
        AND "role" = ${target.role}
        AND (${target.role} = 'officer' OR (SELECT count(*) FROM locked) > 1)
      RETURNING
        "id",
        "role",
        "tier",
        "created_at" AS "createdAt"
    `);
      const member = result.rows[0];
      if (!member) {
        const [current] = await db
          .select({ role: appUsers.role })
          .from(appUsers)
          .where(eq(appUsers.id, target.id));
        res.status(409).json({
          error:
            current?.role === target.role
              ? {
                  code: "ROLE_VACANCY",
                  message: "Promote a successor before removing the last holder of this role.",
                }
              : { code: "ROLE_CHANGED", message: "Member role changed; retry." },
        });
        return;
      }

      res.status(200).json({ member } satisfies ChangeMemberRoleResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── DELETE /api/members/:id ──────────────────────────────────────────────────

/**
 * Offboarding — the only destructive member route, and the one the database
 * cannot protect on its own.
 *
 * Every foreign key into `app_user` is SET NULL or CASCADE, so a bare DELETE
 * succeeds and silently strands the departing member's open tasks with no
 * handover (spec §8, rules 7 and 15). The guards and the ORDER live here:
 *
 *   1. refuse to vacate the last non-officer role (rule 6)
 *   2. reassign open tasks, or refuse (rule 7)
 *   3. delete `app_user`, THEN the auth user (rule 15)
 *
 * No transaction: the Neon HTTP driver has none, so this is a fixed sequence of
 * single statements, same reasoning as the bulk insert in `tasks.ts`. If it
 * fails between the last two steps the account survives without a membership
 * row, which `authenticate` answers with 403 — the fail-closed direction.
 */
membersRouter.delete(
  "/members/:id",
  authenticate,
  authorise(2),
  validate(memberParamsSchema, "params"),
  validate(removeMemberQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { reassignTo } = res.locals.validated as RemoveMemberQuery;
      const db = getDb();
      const targetId = req.params.id!;
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, targetId)).limit(1);

      if (!target) {
        res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member not found." } });
        return;
      }

      // Rule 6. Removing the only treasurer vacates the office just as surely
      // as demoting them, so it answers to the same guard as the role change.
      if (target.role !== "officer") {
        const holders = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.role, target.role));
        if (holders.length <= 1) {
          res.status(409).json({
            error: {
              code: "ROLE_VACANCY",
              message: "Promote a successor before removing the last holder of this role.",
            },
          });
          return;
        }
      }

      // Rule 7. Open is "not done" — a task the club is still waiting on. Any
      // unfinished assignment counts, co-assignees included: the member is
      // leaving either way, and the club should say who holds the work now.
      const openLinks = await db
        .select({ taskId: taskAssignees.taskId })
        .from(taskAssignees)
        .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
        .where(and(eq(taskAssignees.userId, targetId), ne(tasks.status, "done")));

      if (openLinks.length > 0) {
        if (!reassignTo) {
          res.status(409).json({
            error: {
              code: "OPEN_TASKS",
              message: `This member has ${openLinks.length} open task(s). Pass ?reassignTo=<memberId> to hand them over.`,
            },
          });
          return;
        }
        const [successor] = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.id, reassignTo))
          .limit(1);
        if (!successor || reassignTo === targetId) {
          res.status(422).json({
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
              fields: {
                reassignTo: [
                  successor ? "Cannot hand over to the departing member" : "No member with that id",
                ],
              },
            },
          });
          return;
        }
        // The successor replaces the departing slot on those tasks. DO NOTHING
        // on the composite key covers the case where the successor already
        // holds one of them — a duplicate link would be rejected, not merged.
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            INSERT INTO "task_assignee" ("task_id", "user_id")
            SELECT "task_id", ${reassignTo}
            FROM "task_assignee"
            INNER JOIN "task" ON "task"."id" = "task_assignee"."task_id"
            WHERE "task_assignee"."user_id" = ${targetId} AND "task"."status" <> 'done'
            ON CONFLICT DO NOTHING
          `);
          await tx.execute(sql`
            DELETE FROM "task_assignee"
            WHERE "user_id" = ${targetId}
              AND "task_id" IN (SELECT "id" FROM "task" WHERE "status" <> 'done')
          `);
        });
      }

      // Rule 15, in order. The RESTRICT on app_user.auth_user_id is what makes
      // it an order rather than a suggestion: the auth user cannot go first.
      await db.delete(appUsers).where(eq(appUsers.id, targetId));
      await db.delete(authUser).where(eq(authUser.id, target.authUserId));

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
