import { z } from "zod";
import { roleSchema } from "../role/role.js";

export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  expiresAt: z.coerce.date(),
  acceptedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
});

export type Invite = z.infer<typeof inviteSchema>;

export const createInviteSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  role: roleSchema,
  expiresAt: z.coerce
    .date()
    .refine((date) => date > new Date(), "Invite must expire in the future"),
});

export const createInviteResponseSchema = z.object({ invite: inviteSchema });

export type CreateInvite = z.infer<typeof createInviteSchema>;
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;
