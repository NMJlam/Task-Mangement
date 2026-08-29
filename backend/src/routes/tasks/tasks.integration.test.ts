import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, tasks, teams } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const HOUR = 60 * 60 * 1000;
const UNKNOWN_ID = "018f3a4b-0000-7000-8000-0000000000ff";

describe("/api/tasks", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `test-task-${name}`;
    // auth."user".email is UNIQUE and db:seed already owns `<role>@example.com`
    // for all six roles, so fixture emails are namespaced to this suite.
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${authUserId}@example.com`}, true, now(), now())
    `);
    const [row] = await db.insert(appUsers).values({ id: newId(), authUserId, role }).returning();
    return row!;
  }

  /** Signs every subsequent request as this member. */
  function signedInAs(actor: { authUserId: string }) {
    getSession.mockResolvedValue({
      user: { id: actor.authUserId, email: "actor@example.com", emailVerified: true },
    });
  }

  async function team() {
    const [row] = await db
      .insert(teams)
      .values({ id: newId(), name: "test-task-team" })
      .returning();
    return row!;
  }

  async function seedTask(teamId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), teamId, title: "Seeded task", ...overrides })
      .returning();
    return row!;
  }

  // Deleting the team cascades to its tasks; deleting the auth user cascades to
  // app_user. Both prefixes are unique to this file, so parallel fixtures from
  // other suites are untouched.
  async function cleanup() {
    await db.execute(sql`DELETE FROM "teams" WHERE "name" LIKE 'test-task-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-task-%'`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await closeNodeDb();
  });

  describe("POST /api/tasks", () => {
    it("creates a task for any member", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "  Book the venue  ", assigneeId: actor.id });

      expect(response.status).toBe(201);
      expect(response.body.task).toMatchObject({
        teamId,
        title: "Book the venue",
        status: "todo",
        assigneeId: actor.id,
      });
    });

    it("401s without a session", async () => {
      getSession.mockResolvedValue(null);
      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId: UNKNOWN_ID, title: "x" });
      expect(response.status).toBe(401);
    });

    it("422s on a blank title", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app).post("/api/tasks").send({ teamId, title: "   " });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("422s on an unknown team rather than surfacing an FK violation", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId: UNKNOWN_ID, title: "Orphan" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("TEAM_NOT_FOUND");
    });

    it("422s on an unknown assignee, which has no FK to catch it", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "Unassigned", assigneeId: UNKNOWN_ID });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("ASSIGNEE_NOT_FOUND");
    });
  });

  describe("GET /api/tasks", () => {
    it("lists tasks and filters by status", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      await seedTask(teamId, { title: "Open", status: "todo" });
      await seedTask(teamId, { title: "Finished", status: "done" });
      signedInAs(actor);

      const all = await request(app).get("/api/tasks").query({ teamId });
      expect(all.status).toBe(200);
      expect(all.body.tasks).toHaveLength(2);

      const done = await request(app).get("/api/tasks").query({ teamId, status: "done" });
      expect(done.body.tasks).toHaveLength(1);
      expect(done.body.tasks[0]).toMatchObject({ title: "Finished" });
    });

    it("422s on an out-of-range limit", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app).get("/api/tasks").query({ limit: 500 });

      expect(response.status).toBe(422);
    });
  });

  describe("GET /api/tasks/overdue", () => {
    it("returns only past-due tasks that are not done", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const overdue = await seedTask(teamId, {
        title: "Overdue",
        dueAt: new Date(Date.now() - HOUR),
      });
      await seedTask(teamId, {
        title: "Past but done",
        status: "done",
        dueAt: new Date(Date.now() - HOUR),
      });
      await seedTask(teamId, { title: "Due later", dueAt: new Date(Date.now() + HOUR) });
      await seedTask(teamId, { title: "No due date" });
      signedInAs(actor);

      const response = await request(app).get("/api/tasks/overdue").query({ teamId });

      expect(response.status).toBe(200);
      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0]).toMatchObject({ id: overdue.id, title: "Overdue" });
    });

    it("is not captured by the /tasks/:id route", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app).get("/api/tasks/overdue");

      // A 422 here would mean ":id" matched first and failed the uuid check.
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/tasks/:id", () => {
    it("returns one task", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).get(`/api/tasks/${existing.id}`);

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ id: existing.id, title: "Seeded task" });
    });

    it("404s for an unknown id", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app).get(`/api/tasks/${UNKNOWN_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TASK_NOT_FOUND");
    });
  });

  describe("PATCH /api/tasks/:id", () => {
    it("applies a partial update and clears a nullable field", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId, { assigneeId: null });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ title: "Renamed", assigneeId: null });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ title: "Renamed", assigneeId: null });
    });

    it("422s on an empty patch", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).patch(`/api/tasks/${existing.id}`).send({});

      expect(response.status).toBe(422);
    });

    it("404s for an unknown id", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${UNKNOWN_ID}`)
        .send({ title: "Ghost" });

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/tasks/:id/status", () => {
    it("moves a task to a new status", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "in_progress" });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ id: existing.id, status: "in_progress" });
    });

    it("422s on a status outside the enum", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "blocked" });

      expect(response.status).toBe(422);
    });
  });

  describe("DELETE /api/tasks/:id", () => {
    it("rejects a tier-0 member", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).delete(`/api/tasks/${existing.id}`);

      expect(response.status).toBe(403);
    });

    it("deletes for tier 1 and up", async () => {
      const actor = await member("director", "marketing_director");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).delete(`/api/tasks/${existing.id}`);

      expect(response.status).toBe(204);
      const remaining = await request(app).get(`/api/tasks/${existing.id}`);
      expect(remaining.status).toBe(404);
    });

    it("404s for an unknown id", async () => {
      const actor = await member("director", "marketing_director");
      signedInAs(actor);

      const response = await request(app).delete(`/api/tasks/${UNKNOWN_ID}`);

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/tasks/bulk", () => {
    it("rejects a tier-0 member", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks/bulk")
        .send({ tasks: [{ teamId, title: "One" }] });

      expect(response.status).toBe(403);
    });

    it("creates every task in the batch for tier 1 and up", async () => {
      const actor = await member("director", "marketing_director");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks/bulk")
        .send({
          tasks: [
            { teamId, title: "First" },
            { teamId, title: "Second", status: "in_progress" },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.tasks).toHaveLength(2);
      const listed = await request(app).get("/api/tasks").query({ teamId });
      expect(listed.body.tasks).toHaveLength(2);
    });

    it("writes nothing when one task in the batch has a bad reference", async () => {
      const actor = await member("director", "marketing_director");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks/bulk")
        .send({
          tasks: [
            { teamId, title: "Valid" },
            { teamId: UNKNOWN_ID, title: "Orphan" },
          ],
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("TEAM_NOT_FOUND");
      const listed = await request(app).get("/api/tasks").query({ teamId });
      expect(listed.body.tasks).toHaveLength(0);
    });

    it("422s on an empty batch", async () => {
      const actor = await member("director", "marketing_director");
      signedInAs(actor);

      const response = await request(app).post("/api/tasks/bulk").send({ tasks: [] });

      expect(response.status).toBe(422);
    });
  });
});
