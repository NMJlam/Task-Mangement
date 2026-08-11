import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

describe("GET /api/me", () => {
  const db = nodeDb();

  beforeEach(async () => {
    getSession.mockReset();
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-me-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-me-%'`);
    await closeNodeDb();
  });

  it("returns 401 without a session", async () => {
    getSession.mockResolvedValue(null);
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("returns 403 when the account has no membership", async () => {
    getSession.mockResolvedValue({ user: { id: "test-me-missing", email: "missing@example.com" } });
    expect((await request(app).get("/api/me")).status).toBe(403);
  });

  it("returns the linked membership", async () => {
    const authUserId = "test-me-member";
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, 'Test Member', 'member@example.com', true, now(), now())
    `);
    await db.insert(appUsers).values({ id: newId(), authUserId, role: "officer" });
    getSession.mockResolvedValue({ user: { id: authUserId, email: "member@example.com" } });

    const response = await request(app).get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: "member@example.com",
      role: "officer",
      tier: 0,
    });
  });
});
