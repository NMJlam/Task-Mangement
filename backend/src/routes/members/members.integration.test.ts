import type { Role } from "@ctp/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

describe("PATCH /api/members/:id/role", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `test-role-${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${name}@example.com`}, true, now(), now())
    `);
    const [row] = await db.insert(appUsers).values({ id: newId(), authUserId, role }).returning();
    return row!;
  }

  beforeEach(async () => {
    getSession.mockReset();
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-role-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-role-%'`);
    await closeNodeDb();
  });

  it("rejects granting a role above the actor tier", async () => {
    const actor = await member("actor", "marketing_director");
    const target = await member("target", "officer");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${target.id}/role`)
      .send({ role: "president" });

    expect(response.status).toBe(403);
  });

  it("rejects changing a member above the actor tier", async () => {
    const actor = await member("actor", "marketing_director");
    const target = await member("target", "president");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${target.id}/role`)
      .send({ role: "officer" });

    expect(response.status).toBe(403);
  });

  it("rejects roles without the change-role capability", async () => {
    const actor = await member("actor", "secretary");
    const target = await member("target", "officer");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${target.id}/role`)
      .send({ role: "marketing_director" });

    expect(response.status).toBe(403);
  });

  it("rejects removing the last holder of a non-officer role", async () => {
    const actor = await member("actor", "vice_president");
    const [target] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.authUserId, "seed-treasurer"));
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${target!.id}/role`)
      .send({ role: "officer" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROLE_VACANCY");
  });

  it("allows self-demotion after a successor exists", async () => {
    const actor = await member("actor", "vice_president");
    await member("successor", "vice_president");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${actor.id}/role`)
      .send({ role: "officer" });

    expect(response.status).toBe(200);
    expect(response.body.member).toMatchObject({ id: actor.id, role: "officer", tier: 0 });
    expect((await db.select().from(appUsers).where(eq(appUsers.id, actor.id)))[0]?.role).toBe(
      "officer",
    );
  });

  it("serializes concurrent changes so one role holder remains", async () => {
    const actor = await member("actor", "president");
    const first = await member("first", "secretary");
    const second = await member("second", "secretary");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });
    await db
      .update(appUsers)
      .set({ role: "officer" })
      .where(eq(appUsers.authUserId, "seed-secretary"));

    try {
      const responses = await Promise.all(
        [first, second].map((target) =>
          request(app).patch(`/api/members/${target.id}/role`).send({ role: "officer" }),
        ),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(await db.select().from(appUsers).where(eq(appUsers.role, "secretary"))).toHaveLength(
        1,
      );
    } finally {
      await db
        .update(appUsers)
        .set({ role: "secretary" })
        .where(eq(appUsers.authUserId, "seed-secretary"));
    }
  });
});
