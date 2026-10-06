import type { Role } from "@ctp/shared";
import { and, eq, inArray, notLike, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  /**
   * Two vice-presidents and nobody else, so removing both would empty the
   * office. Whoever else holds the role (the seed's) is moved aside for each
   * test and put back after, so nothing leaks into the seeded roster.
   */
  describe("offboarding races and failures", () => {
    let movedAside: string[] = [];

    beforeEach(async () => {
      const others = await db
        .update(appUsers)
        .set({ role: "officer" })
        .where(
          and(eq(appUsers.role, "vice_president"), notLike(appUsers.authUserId, "test-role-%")),
        )
        .returning({ id: appUsers.id });
      movedAside = others.map((row) => row.id);
    });

    afterEach(async () => {
      if (movedAside.length > 0) {
        await db
          .update(appUsers)
          .set({ role: "vice_president" })
          .where(inArray(appUsers.id, movedAside));
      }
      movedAside = [];
    });

    async function vicePresidents() {
      return db.select().from(appUsers).where(eq(appUsers.role, "vice_president"));
    }

    it("lets only one of two concurrent removals of the last two holders through", async () => {
      const actor = await member("actor", "president");
      const first = await member("vp-one", "vice_president");
      const second = await member("vp-two", "vice_president");
      getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

      const responses = await Promise.all(
        [first, second].map((target) => request(app).delete(`/api/members/${target.id}`)),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([204, 409]);
      expect(responses.find(({ status }) => status === 409)?.body.error.code).toBe("ROLE_VACANCY");
      expect(await vicePresidents()).toHaveLength(1);
    });

    it("serialises a removal against a demotion of the other holder", async () => {
      const actor = await member("actor", "president");
      const leaving = await member("vp-leaving", "vice_president");
      const demoted = await member("vp-demoted", "vice_president");
      getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

      const [removal, demotion] = await Promise.all([
        request(app).delete(`/api/members/${leaving.id}`),
        request(app).patch(`/api/members/${demoted.id}/role`).send({ role: "officer" }),
      ]);

      const succeeded = [removal.status === 204, demotion.status === 200].filter(Boolean);
      expect(succeeded).toHaveLength(1);
      expect(await vicePresidents()).toHaveLength(1);
    });

    /** Resolves once a query is queued behind a row lock, so a race is staged, not hoped for. */
    async function someoneWaitsOnALock() {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const result = await db.execute<{ waiting: number }>(sql`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `);
        if (Number(result.rows[0]?.waiting) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("No query ever waited on the lock");
    }

    it("waits for an assignment still in flight, then sees it and asks for a handover", async () => {
      const actor = await member("actor", "president");
      const leaving = await member("leaving", "officer");
      const [open] = await db
        .insert(tasks)
        .values({ id: newId(), title: "test-role-in-flight", creator: actor.id })
        .returning();
      getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

      let removal: Promise<request.Response> | undefined;
      await db.transaction(async (tx) => {
        // The assignment is written but not committed: its foreign key holds a
        // key-share lock on the departing member until it is.
        await tx.insert(taskAssignees).values({ taskId: open!.id, userId: leaving.id });
        removal = request(app)
          .delete(`/api/members/${leaving.id}`)
          .then((response) => response);
        await someoneWaitsOnALock();
      });

      const response = await removal!;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("OPEN_TASKS");
      expect(await db.select().from(appUsers).where(eq(appUsers.id, leaving.id))).toHaveLength(1);
      const links = await db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, open!.id));
      expect(links.map((link) => link.userId)).toEqual([leaving.id]);
    });

    it("answers an assignment that loses the race with a 422, and leaves the task alone", async () => {
      const actor = await member("actor", "president");
      const leaving = await member("leaving", "officer");
      const [open] = await db
        .insert(tasks)
        .values({ id: newId(), title: "test-role-lost-race", creator: actor.id })
        .returning();
      getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });

      let assigning: Promise<request.Response> | undefined;
      await db.transaction(async (tx) => {
        // Offboarding holds the member's row…
        await tx.execute(sql`SELECT 1 FROM "app_user" WHERE "id" = ${leaving.id} FOR UPDATE`);
        assigning = request(app)
          .patch(`/api/tasks/${open!.id}`)
          .send({ assigneeIds: [leaving.id] })
          .then((response) => response);
        await someoneWaitsOnALock();
        // …and deletes it before committing.
        await tx.delete(appUsers).where(eq(appUsers.id, leaving.id));
      });

      const response = await assigning!;
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("ASSIGNEE_NOT_FOUND");
      expect(
        await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, open!.id)),
      ).toHaveLength(0);
    });

    it("rolls the whole offboarding back when its last step fails", async () => {
      const actor = await member("actor", "president");
      const leaving = await member("leaving", "officer");
      const successor = await member("successor", "officer");
      const [open] = await db
        .insert(tasks)
        .values({ id: newId(), title: "test-role-rollback", creator: actor.id })
        .returning();
      await db.insert(taskAssignees).values({ taskId: open!.id, userId: leaving.id });
      getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });
      // The auth user is deleted last, so failing it proves everything before
      // it — the handover and the membership delete — rolls back with it.
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION test_role_refuse_delete() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$
      `);
      await db.execute(
        sql.raw(`
          CREATE TRIGGER test_role_refuse_delete BEFORE DELETE ON auth."user"
          FOR EACH ROW WHEN (OLD.id = '${leaving.authUserId}')
          EXECUTE FUNCTION test_role_refuse_delete()
        `),
      );
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const response = await request(app).delete(
          `/api/members/${leaving.id}?reassignTo=${successor.id}`,
        );
        expect(response.status).toBe(500);
      } finally {
        quiet.mockRestore();
        await db.execute(sql`DROP TRIGGER IF EXISTS test_role_refuse_delete ON auth."user"`);
        await db.execute(sql`DROP FUNCTION IF EXISTS test_role_refuse_delete()`);
      }

      expect(await db.select().from(appUsers).where(eq(appUsers.id, leaving.id))).toHaveLength(1);
      const links = await db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, open!.id));
      expect(links.map((link) => link.userId)).toEqual([leaving.id]);
    });
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
