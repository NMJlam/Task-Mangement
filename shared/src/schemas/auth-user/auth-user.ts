import { z } from "zod";
import { roleSchema, tierSchema } from "../role/role.js";

/**
 * The authenticated identity, as both sides see it. Derived on the backend from
 * the validated Better Auth session (`id` = the Better Auth user id, our stable
 * identity key) and attached to `req.user`; consumed by the frontend as the
 * shape of GET /api/me. Defined once here per the "shared is the only home for a
 * domain type" rule.
 */
export const authUserSchema = z.object({
  /** Application membership id. */
  id: z.uuid(),
  /** Email from the Google/OIDC claims. May be empty if not present in the profile. */
  email: z.string(),
  role: roleSchema,
  tier: tierSchema,
});

export type AuthUser = z.infer<typeof authUserSchema>;

/** Response shape for GET /api/me — the current user behind `authenticate`. */
export const meResponseSchema = z.object({
  user: authUserSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;
