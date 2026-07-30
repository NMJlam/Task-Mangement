import { z } from "zod";

/** Response shape for GET /api/health. */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  /** Short git SHA of the running build, from env. Empty string when unknown. */
  commit: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
