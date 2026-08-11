import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, invites } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

describe("GET /api/me", () => {
  const db = nodeDb();

  beforeEach(async () => {
    getSession.mockReset();
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-me-%'`);
    await db.execute(sql`DELETE FROM ${invites} WHERE ${invites.email} LIKE 'test-me-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-me-%'`);
    await db.execute(sql`DELETE FROM ${invites} WHERE ${invites.email} LIKE 'test-me-%'`);
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

  it("joins an account to the club when it has a live invite", async () => {
    const authUserId = "test-me-invited";
    const email = "test-me-invited@example.com";
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, 'Invited Member', ${email}, true, now(), now())
    `);
    await db.insert(invites).values({
      id: newId(),
      email,
      role: "marketing_director",
      expiresAt: new Date(Date.now() + 60_000),
    });
    getSession.mockResolvedValue({
      user: { id: authUserId, email, emailVerified: true },
    });

    const response = await request(app).get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email, role: "marketing_director", tier: 1 });
    expect(
      (await db.select().from(invites).where(eq(invites.email, email)))[0]?.acceptedAt,
    ).not.toBeNull();
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
