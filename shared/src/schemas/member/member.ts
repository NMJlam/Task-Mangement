import { z } from "zod";
import { roleSchema, tierSchema } from "../role/role.js";

export const memberSchema = z.object({
  id: z.uuid(),
  role: roleSchema,
  tier: tierSchema,
  createdAt: z.coerce.date(),
});

export type Member = z.infer<typeof memberSchema>;

export const changeMemberRoleParamsSchema = z.object({ id: z.uuid() });
export const changeMemberRoleSchema = z.object({ role: roleSchema });
export const changeMemberRoleResponseSchema = z.object({ member: memberSchema });

export type ChangeMemberRole = z.infer<typeof changeMemberRoleSchema>;
export type ChangeMemberRoleResponse = z.infer<typeof changeMemberRoleResponseSchema>;
