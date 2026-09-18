import type { Role } from "@ctp/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, taskAssignees, tasks, teamMembers, teams } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

describe("/api/members (integration)", () => {
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
    await db.execute(sql`DELETE FROM "task" WHERE "title" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM "team" WHERE "name" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-role-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM "task" WHERE "title" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM "team" WHERE "name" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-role-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-role-%'`);
    await closeNodeDb();
  });

  it("rejects granting a role above the actor tier", async () => {
    const actor = await member("actor", "director");
    const target = await member("target", "officer");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app)
      .patch(`/api/members/${target.id}/role`)
      .send({ role: "president" });

    expect(response.status).toBe(403);
  });

  it("rejects changing a member above the actor tier", async () => {
    const actor = await member("actor", "director");
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
      .send({ role: "director" });

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

  it("allows concurrent demotions when another role holder remains", async () => {
    const actor = await member("actor", "president");
    const existing = await member("existing-secretary", "secretary");
    const first = await member("first", "secretary");
    const second = await member("second", "secretary");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const responses = await Promise.all(
      [first, second].map((target) =>
        request(app).patch(`/api/members/${target.id}/role`).send({ role: "officer" }),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 200]);
    expect(responses.map(({ body }) => body.member.role)).toEqual(["officer", "officer"]);
    expect((await db.select().from(appUsers).where(eq(appUsers.id, existing.id)))[0]?.role).toBe(
      "secretary",
    );
  });

  it("returns the roster with team ids and a derived portfolio", async () => {
    const lead = await member("roster-lead", "director");
    const officer = await member("roster-officer", "officer");
    const [marketing] = await db
      .insert(teams)
      .values({ id: newId(), name: "test-role-marketing", lead: lead.id })
      .returning();
    await db.insert(teamMembers).values({ teamId: marketing!.id, userId: lead.id });
    // Signed in as tier 0: everyone needs the roster to assign a task.
    getSession.mockResolvedValue({ user: { id: officer.authUserId, email: "o@example.com" } });

    const response = await request(app).get("/api/members");

    expect(response.status).toBe(200);
    const row = response.body.members.find((m: { id: string }) => m.id === lead.id);
    expect(row).toMatchObject({
      role: "director",
      tier: 1,
      name: "roster-lead",
      email: "roster-lead@example.com",
      portfolio: "test-role-marketing",
    });
    expect(row.teamIds).toEqual([marketing!.id]);
    // A member who leads nothing has no portfolio — the accepted gap.
    expect(
      response.body.members.find((m: { id: string }) => m.id === officer.id).portfolio,
    ).toBeNull();
  });

  it("refuses to remove the last holder of a non-officer role", async () => {
    const actor = await member("actor", "president");
    const [target] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.authUserId, "seed-treasurer"));
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app).delete(`/api/members/${target!.id}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROLE_VACANCY");
    expect(await db.select().from(appUsers).where(eq(appUsers.id, target!.id))).toHaveLength(1);
  });

  it("refuses to remove a member with open tasks, then hands them over", async () => {
    const actor = await member("actor", "president");
    const leaving = await member("leaving", "officer");
    const successor = await member("successor", "officer");
    const [open] = await db
      .insert(tasks)
      .values({ id: newId(), title: "test-role-open", creator: actor.id })
      .returning();
    await db.insert(taskAssignees).values({ taskId: open!.id, userId: leaving.id });
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const blocked = await request(app).delete(`/api/members/${leaving.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("OPEN_TASKS");

    const removed = await request(app).delete(
      `/api/members/${leaving.id}?reassignTo=${successor.id}`,
    );
    expect(removed.status).toBe(204);

    // The successor takes the departing slot, and the departing link is gone.
    const links = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, open!.id));
    expect(links.map((link) => link.userId)).toEqual([successor.id]);
    expect(await db.select().from(appUsers).where(eq(appUsers.id, leaving.id))).toHaveLength(0);
    // Rule 15: the auth user goes last, which revokes the session.
    const authRows = await db.execute(
      sql`SELECT 1 FROM auth."user" WHERE id = ${leaving.authUserId}`,
    );
    expect(authRows.rows).toHaveLength(0);
  });

  // A shared task is still open work for the person leaving, so the same guard
  // applies — but the handover must not try to insert a link the successor
  // already holds, and must not drop the co-assignee who is staying.
  it("requires a handover even when co-assignees remain, and keeps them", async () => {
    const actor = await member("actor", "president");
    const leaving = await member("leaving", "officer");
    const staying = await member("staying", "officer");
    const successor = await member("successor", "officer");
    const [shared] = await db
      .insert(tasks)
      .values({ id: newId(), title: "test-role-shared", creator: actor.id })
      .returning();
    await db.insert(taskAssignees).values([
      { taskId: shared!.id, userId: leaving.id },
      { taskId: shared!.id, userId: staying.id },
      { taskId: shared!.id, userId: successor.id },
    ]);
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const blocked = await request(app).delete(`/api/members/${leaving.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("OPEN_TASKS");

    const removed = await request(app).delete(
      `/api/members/${leaving.id}?reassignTo=${successor.id}`,
    );
    expect(removed.status).toBe(204);

    const links = await db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, shared!.id));
    // Deduplicated through the composite key: the successor holds it once.
    expect(links.map((link) => link.userId).sort()).toEqual([staying.id, successor.id].sort());
  });

  it("removes a member who holds no open tasks", async () => {
    const actor = await member("actor", "president");
    const leaving = await member("leaving", "officer");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app).delete(`/api/members/${leaving.id}`);

    expect(response.status).toBe(204);
    expect(await db.select().from(appUsers).where(eq(appUsers.id, leaving.id))).toHaveLength(0);
  });

  it("refuses member removal below tier 2", async () => {
    const actor = await member("actor", "director");
    const leaving = await member("leaving", "officer");
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

    const response = await request(app).delete(`/api/members/${leaving.id}`);

    expect(response.status).toBe(403);
    expect(await db.select().from(appUsers).where(eq(appUsers.id, leaving.id))).toHaveLength(1);
  });
});
