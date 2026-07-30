import { z } from "zod";

/**
 * The single API error shape, defined once and shared by both sides.
 * The validation middleware (backend) responds with this on 422, and the
 * frontend can parse any error response against it. Defining it here is the
 * "types defined once" rule from §1.2 / §4.1 of the proposal.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    /** Machine-readable code, e.g. "VALIDATION_ERROR". */
    code: z.string(),
    /** Human-readable summary safe to surface in the UI. */
    message: z.string(),
    /** Optional field-level issues, keyed by dotted field path. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
