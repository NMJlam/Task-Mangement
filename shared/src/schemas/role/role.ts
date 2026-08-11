import { z } from "zod";

export const roleSchema = z.enum([
  "president",
  "vice_president",
  "treasurer",
  "secretary",
  "marketing_director",
  "officer",
]);

export type Role = z.infer<typeof roleSchema>;

export const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export type Tier = z.infer<typeof tierSchema>;

export const ROLE_TIER = {
  president: 2,
  vice_president: 2,
  treasurer: 2,
  secretary: 2,
  marketing_director: 1,
  officer: 0,
} as const satisfies Record<Role, Tier>;

export function tierForRole(role: Role): Tier {
  return ROLE_TIER[role];
}
