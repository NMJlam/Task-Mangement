import {
  changeMemberRoleParamsSchema,
  changeMemberRoleSchema,
  can,
  tierForRole,
  type ChangeMemberRole,
  type ChangeMemberRoleResponse,
  type Member,
} from "@ctp/shared";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { appUsers } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const membersRouter = Router();

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
