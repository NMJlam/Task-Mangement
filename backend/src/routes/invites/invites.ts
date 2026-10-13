import {
  createInviteSchema,
  can,
  inviteParamsSchema,
  roleSchema,
  tierForRole,
  type CreateInvite,
  type CreateInviteResponse,
  type InviteListResponse,
} from "@ctp/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { invites } from "../../db/schema/index.js";
import { authenticate, authorise, authoriseCapability, validate } from "../../middleware/index.js";

export const invitesRouter = Router();

/** Rule 1: you only see and revoke invites you could have created. */
const rolesUpTo = (tier: number) => roleSchema.options.filter((role) => tierForRole(role) <= tier);

/**
 * Pending only, with the same "live" test `authenticate.ts` redeems on: an
 * accepted invite is already in the directory and a revoked one is done, so the
 * list holds just the invites still waiting on someone. The rows stay as history.
 */
invitesRouter.get(
  "/invites",
  authenticate,
  authorise(1),
  authoriseCapability("invite:create"),
  async (req, res, next) => {
    try {
      const rows = await getDb()
        .select()
        .from(invites)
        .where(
          and(
            inArray(invites.role, rolesUpTo(req.user!.tier)),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            sql`(${invites.expiresAt} IS NULL OR ${invites.expiresAt} > now())`,
          ),
        )
        .orderBy(desc(invites.createdAt));
      res.json({
        invites: rows.map((row) => ({ ...row, status: "pending" as const })),
      } satisfies InviteListResponse);
    } catch (error) {
      next(error);
    }
  },
);

invitesRouter.post(
  "/invites",
  authenticate,
  authorise(1),
  validate(createInviteSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateInvite;
      if (tierForRole(input.role) > req.user!.tier) {
        res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Invite role exceeds your tier." } });
        return;
      }
      if (!can(req.user!.role, "invite:create")) {
        res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Role cannot create invites." } });
        return;
      }

      const [invite] = await getDb()
        .insert(invites)
        .values({ id: newId(), ...input })
        .returning();
      res
        .status(201)
        .json({ invite: { ...invite!, status: "pending" } } satisfies CreateInviteResponse);
    } catch (error) {
      next(error);
    }
  },
);

/** Revoking stamps `revoked_at`; the row stays as history. */
invitesRouter.delete(
  "/invites/:id",
  authenticate,
  authorise(1),
  authoriseCapability("invite:create"),
  validate(inviteParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const [revoked] = await getDb()
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.id, req.params.id!),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            inArray(invites.role, rolesUpTo(req.user!.tier)),
          ),
        )
        .returning({ id: invites.id });
      if (!revoked) {
        res.status(404).json({
          error: { code: "INVITE_NOT_FOUND", message: "No pending invite with that id." },
        });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
