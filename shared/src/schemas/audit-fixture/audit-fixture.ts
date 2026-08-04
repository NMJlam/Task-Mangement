import { z } from "zod";

/**
 * Body schema for the POST /api/example/audit reference route — a TESTING
 * FIXTURE (not a real requirement, so no `TODO(Rn)`). It demonstrates the full
 * shared-schema → validate → getDb() → insert flow end to end, and is the route
 * the backend integration test (`*.integration.test.ts`) exercises. Define real
 * feature schemas here the same way. See docs/contributing.md and
 * docs/architecture.md.
 */
export const auditFixtureSchema = z.object({
  action: z.string().min(1, "action is required"),
  entityType: z.string().min(1, "entityType is required"),
  entityId: z.uuid().optional(),
});

export type AuditFixture = z.infer<typeof auditFixtureSchema>;
