import {
  createInviteSchema,
  can,
  tierForRole,
  type CreateInvite,
  type CreateInviteResponse,
} from "@ctp/shared";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { invites } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const invitesRouter = Router();

invitesRouter.post(
  "/invites",
  authenticate,
  authorise(1),
  validate(createInviteSchema),
  async (req, res) => {
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
  },
);
