import { z } from "zod";
import { roleSchema } from "../role/role.js";

export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  expiresAt: z.coerce.date().nullable(),
  acceptedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
});

export type Invite = z.infer<typeof inviteSchema>;

export const createInviteSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  role: roleSchema,
});

export const createInviteResponseSchema = z.object({ invite: inviteSchema });
export const inviteListResponseSchema = z.object({ invites: z.array(inviteSchema) });
export const inviteParamsSchema = z.object({ id: z.uuid() });

export type CreateInvite = z.infer<typeof createInviteSchema>;
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;
