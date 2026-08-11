import { auditFixtureSchema, exampleFormSchema, type AuditFixture } from "@ctp/shared";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { auditLog } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const exampleRouter = Router();

/**
 * Reference route showing the full chain shape for a mutating endpoint:
 *   authenticate → authorise → validate(schemaFromShared) → handler
 * `log` is applied globally in app.ts, so it is not repeated here.
 *
 * The schema is imported from `@ctp/shared` and is the SAME one the stub form
 * uses on the frontend — copy this pattern for real endpoints. TODO(Rn).
 */
exampleRouter.post(
  "/example",
  authenticate,
  authorise(0),
  validate(exampleFormSchema, "body"),
  (_req, res) => {
    res.status(200).json({ ok: true, received: res.locals.validated });
  },
);

/**
 * Reference route for a route that TOUCHES THE DATABASE — a testing fixture (not
 * an `R`-numbered requirement). It inserts one row into the append-only
 * `audit_log` via getDb(), so the same handler runs against Docker Postgres in
 * tests and Neon in production. It is the endpoint the backend integration test
 * (`example.integration.test.ts`) drives with supertest, and the template for
 * real DB-backed routes: shared schema → validate → getDb() → query. TODO(Rn).
 */
exampleRouter.post(
  "/example/audit",
  authenticate,
  authorise(0),
  validate(auditFixtureSchema, "body"),
  async (_req, res) => {
    const input = res.locals.validated as AuditFixture;
    const db = getDb();
    const [row] = await db
      .insert(auditLog)
      .values({
        id: newId(),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
      })
      .returning();
    res.status(201).json({ ok: true, entry: row });
  },
);
