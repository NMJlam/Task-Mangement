import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, auditLog } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

/**
 * DB-backed integration test: drives the real Express app (full middleware
 * chain) with supertest against Docker Postgres. Isolation is a per-test
 * TRUNCATE of ONLY `audit_log` — the append-only table this fixture route
 * writes to, so other tests and Drizzle Studio keep their data. See
 * docs/contributing.md.
 */
describe("POST /api/example/audit (integration)", () => {
  const db = nodeDb();
  const authUserId = "test-audit-member";

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, 'Audit Member', 'audit@example.com', true, now(), now())
      ON CONFLICT (id) DO NOTHING
    `);
    await db
      .insert(appUsers)
      .values({ id: newId(), authUserId, role: "officer" })
      .onConflictDoNothing({ target: appUsers.authUserId });
    getSession.mockResolvedValue({ user: { id: authUserId, email: "audit@example.com" } });
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${auditLog}`);
  });

  afterAll(async () => {
    await db.execute(sql`TRUNCATE TABLE ${auditLog}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" = ${authUserId}`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id = ${authUserId}`);
    await closeNodeDb();
  });

  it("inserts a row and returns it (201)", async () => {
    const res = await request(app)
      .post("/api/example/audit")
      .send({ action: "task.updated", entityType: "task" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, entry: { action: "task.updated" } });

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "task.updated", entityType: "task" });
  });

  it("rejects invalid input with the shared ApiError shape (422)", async () => {
    const res = await request(app).post("/api/example/audit").send({ action: "" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(0);
  });
});
