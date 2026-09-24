import type { Role } from "@ctp/shared";
import { asc, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  appUsers,
  events,
  taskAssignees,
  tasks,
  teams,
  workstreams,
} from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
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

  // team.name is UNIQUE, and the event-link tests need two teams at once.
  async function team(name = "test-task-team") {
    const [row] = await db.insert(teams).values({ id: newId(), name }).returning();
    return row!;
  }

  async function event(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({
        id: newId(),
        title: "test-task-event",
        startsAt: new Date(Date.now() + DAY),
        ...overrides,
      })
      .returning();
    return row!;
  }

  /** The teams with a workstream on this event, sorted for stable comparison. */
  async function workstreamTeams(eventId: string) {
    const rows = await db
      .select({ teamId: workstreams.teamId })
      .from(workstreams)
      .where(eq(workstreams.eventId, eventId));
    return rows.map((row) => row.teamId).sort();
  }

  async function seedTask(teamId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), teamId, title: "Seeded task", ...overrides })
      .returning();
    return row!;
  }

  /** Writes the junction rows a task's ownership now lives in. */
  async function assignTo(taskId: string, userIds: readonly string[]) {
    if (userIds.length === 0) return;
    await db.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })));
  }

  // Delete order follows the FKs. Events go first: deleting one cascades to its
  // workstreams and, through the composite FK, to their tasks — and
  // workstream.team_id is RESTRICT, so no team can go while one points at it.
  // The rest do NOT cascade: task.team_id and task.creator are ON DELETE SET
  // NULL, and app_user.auth_user_id is ON DELETE RESTRICT. Dropping the team
  // first would only NULL the task's team_id and strand the row; dropping the
  // auth user first errors outright. The prefix is unique to this file, so
  // parallel fixtures from other suites are untouched.
  async function cleanup() {
    await db.execute(sql`DELETE FROM "event" WHERE "title" LIKE 'test-task-%'`);
    await db.execute(sql`
      DELETE FROM "task"
      WHERE "team_id" IN (SELECT "id" FROM "team" WHERE "name" LIKE 'test-task-%')
         OR "creator" IN (SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE 'test-task-%')
         OR "id" IN (
              SELECT "task_id" FROM "task_assignee"
              WHERE "user_id" IN (
                SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE 'test-task-%'
              )
            )
    `);
    await db.execute(sql`DELETE FROM "team" WHERE "name" LIKE 'test-task-%'`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-task-%'`);
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
        .send({ teamId, title: "  Book the venue  " });

      expect(response.status).toBe(201);
      expect(response.body.task).toMatchObject({
        teamId,
        title: "Book the venue",
        status: "todo",
        priority: "medium",
        assigneeIds: [],
      });
    });

    it("creates a task owned by two members", async () => {
      const actor = await member("officer", "officer");
      const director = await member("director", "director");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "Share the load", assigneeIds: [actor.id, director.id] });

      expect(response.status).toBe(201);
      expect(response.body.task.assigneeIds).toEqual([actor.id, director.id]);
      // The rows are real, not just echoed back: the junction holds both.
      const links = await db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, response.body.task.id));
      expect(links.map((link) => link.userId).sort()).toEqual([actor.id, director.id].sort());
    });

    it("stores and returns a description, trimming it", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const created = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "With detail", description: "  Bring the AV cart.  " });
      expect(created.status).toBe(201);
      expect(created.body.task.description).toBe("Bring the AV cart.");

      // An emptied field clears it, and the read path agrees.
      const cleared = await request(app)
        .patch(`/api/tasks/${created.body.task.id}`)
        .send({ description: "" });
      expect(cleared.status).toBe(200);
      expect(cleared.body.task.description).toBeNull();

      const reread = await request(app).get(`/api/tasks/${created.body.task.id}`);
      expect(reread.body.task.description).toBeNull();
    });

    // `creator` is stamped from the session, so a caller cannot attribute work
    // to someone else by putting a different id in the body.
    it("stamps creator from the session and ignores a body-supplied one", async () => {
      const actor = await member("officer", "officer");
      const other = await member("secretary", "secretary");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "Own it", creator: other.id });

      expect(response.status).toBe(201);
      expect(response.body.task.creator).toBe(actor.id);
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

    it("422s on an unknown assignee rather than surfacing an FK violation", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ teamId, title: "Unassigned", assigneeIds: [UNKNOWN_ID] });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("ASSIGNEE_NOT_FOUND");
    });

    it("422s the batch when one assignee in the whole batch is unknown", async () => {
      const actor = await member("director", "director");
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks/bulk")
        .send({
          tasks: [
            { teamId, title: "Fine", assigneeIds: [actor.id] },
            { teamId, title: "Not fine", assigneeIds: [UNKNOWN_ID] },
          ],
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("ASSIGNEE_NOT_FOUND");
    });
  });

  describe("GET /api/tasks", () => {
    it("lists tasks and filters by status", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      await seedTask(teamId, { title: "Open", status: "todo" });
      await seedTask(teamId, { title: "Finished", status: "done", completedAt: new Date() });
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

    // `?assignee=` is membership: a task held by two people answers for either
    // of them, and answers once — the join must not multiply the row.
    it("returns a shared task once for either of its assignees", async () => {
      const actor = await member("officer", "officer");
      const director = await member("director", "director");
      const { id: teamId } = await team();
      const shared = await seedTask(teamId, { title: "Shared" });
      await assignTo(shared.id, [actor.id, director.id]);
      await seedTask(teamId, { title: "Unowned" });
      signedInAs(actor);

      for (const assignee of [actor.id, director.id]) {
        const response = await request(app).get("/api/tasks").query({ teamId, assignee });
        expect(response.status).toBe(200);
        expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
          "Shared",
        ]);
      }

      const bystander = await member("treasurer", "treasurer");
      const none = await request(app).get("/api/tasks").query({ teamId, assignee: bystander.id });
      expect(none.body.tasks).toEqual([]);
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
        completedAt: new Date(),
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

    it("narrows to one priority, which the derived overdue rule does not already imply", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      await seedTask(teamId, {
        title: "Overdue urgent",
        priority: "urgent",
        dueAt: new Date(Date.now() - HOUR),
      });
      await seedTask(teamId, {
        title: "Overdue low",
        priority: "low",
        dueAt: new Date(Date.now() - HOUR),
      });
      signedInAs(actor);

      const response = await request(app)
        .get("/api/tasks/overdue")
        .query({ teamId, priority: "urgent" });

      expect(response.status).toBe(200);
      expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
        "Overdue urgent",
      ]);
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
      const director = await member("director", "director");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      await assignTo(existing.id, [actor.id, director.id]);
      signedInAs(actor);

      const response = await request(app).get(`/api/tasks/${existing.id}`);

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({
        id: existing.id,
        title: "Seeded task",
        assigneeIds: [actor.id, director.id],
      });
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
    it("applies a partial update", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ title: "Renamed", dueAt: null });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ title: "Renamed", dueAt: null });
    });

    it("replaces the assignment set with the submitted one", async () => {
      const actor = await member("officer", "officer");
      const director = await member("director", "director");
      const secretary = await member("secretary", "secretary");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      await assignTo(existing.id, [actor.id, director.id]);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ assigneeIds: [secretary.id, director.id] });

      expect(response.status).toBe(200);
      expect(response.body.task.assigneeIds).toEqual([secretary.id, director.id]);
    });

    it("leaves the set alone when the patch omits it", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      await assignTo(existing.id, [actor.id]);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ title: "Renamed" });

      expect(response.status).toBe(200);
      expect(response.body.task.assigneeIds).toEqual([actor.id]);
    });

    it("unassigns everyone with an empty set", async () => {
      const actor = await member("officer", "officer");
      const director = await member("director", "director");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      await assignTo(existing.id, [actor.id, director.id]);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ assigneeIds: [] });

      expect(response.status).toBe(200);
      expect(response.body.task.assigneeIds).toEqual([]);
      expect(
        await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, existing.id)),
      ).toHaveLength(0);
    });

    it("422s ASSIGNEE_NOT_FOUND on an unknown member in the patch", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ assigneeIds: [UNKNOWN_ID] });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("ASSIGNEE_NOT_FOUND");
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

    // The marker is backend operational state; these two rows are what make the
    // nightly sweep once per overdue cycle rather than every night (R10).
    it("starts a new overdue cycle when the deadline moves, and clears it outright", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const escalatedAt = new Date();
      const existing = await seedTask(teamId, {
        dueAt: new Date(Date.now() - HOUR),
        priority: "urgent",
        overdueEscalatedAt: escalatedAt,
      });
      signedInAs(actor);

      // A priority edit is not a new cycle: the marker stands, which is what
      // preserves a user's change past the next sweep.
      await request(app).patch(`/api/tasks/${existing.id}`).send({ priority: "low" });
      const [afterPriority] = await db.select().from(tasks).where(eq(tasks.id, existing.id));
      expect(afterPriority!.overdueEscalatedAt).toEqual(escalatedAt);

      // A moved deadline is: the sweep may escalate the task again.
      await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ dueAt: new Date(Date.now() + HOUR).toISOString() });
      const [afterMove] = await db.select().from(tasks).where(eq(tasks.id, existing.id));
      expect(afterMove!.overdueEscalatedAt).toBeNull();

      // As is clearing it entirely.
      await db
        .update(tasks)
        .set({ overdueEscalatedAt: new Date() })
        .where(eq(tasks.id, existing.id));
      await request(app).patch(`/api/tasks/${existing.id}`).send({ dueAt: null });
      const [afterClear] = await db.select().from(tasks).where(eq(tasks.id, existing.id));
      expect(afterClear!.overdueEscalatedAt).toBeNull();
    });

    it("never returns the escalation marker on the wire", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId, { overdueEscalatedAt: new Date() });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ title: "Renamed" });

      expect(response.status).toBe(200);
      expect(response.body.task).not.toHaveProperty("overdueEscalatedAt");
    });
  });

  describe("PATCH /api/tasks/:id/status", () => {
    it("moves a task to a new status", async () => {
      const actor = await member("officer", "officer");
      const director = await member("director", "director");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      await assignTo(existing.id, [actor.id, director.id]);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "in_progress" });

      expect(response.status).toBe(200);
      // The status write touches the task row alone, so the set must survive it.
      expect(response.body.task).toMatchObject({
        id: existing.id,
        status: "in_progress",
        assigneeIds: [actor.id, director.id],
      });
    });

    it("accepts blocked, which is a first-class status here", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "blocked" });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ status: "blocked" });
    });

    it("422s on a status outside the enum", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "archived" });

      expect(response.status).toBe(422);
    });

    // The table enforces `(status = 'done') = (completed_at IS NOT NULL)`, so
    // the route derives the timestamp on every status write. Without this the
    // CHECK turns an ordinary board move into a 500.
    it("stamps completed_at on the way into done and clears it on the way out", async () => {
      const actor = await member("officer", "officer");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const done = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "done" });

      expect(done.status).toBe(200);
      expect(done.body.task.completedAt).not.toBeNull();

      const reopened = await request(app)
        .patch(`/api/tasks/${existing.id}/status`)
        .send({ status: "todo" });

      expect(reopened.status).toBe(200);
      expect(reopened.body.task.completedAt).toBeNull();
    });

    /**
     * One column as the board reads it: stored slot ascending, and every card of
     * that status — events and the standing board together, which is what the
     * endpoint renumbers and what `/tasks` shows in one column.
     */
    async function column(status: "todo" | "in_progress" | "done") {
      return db
        .select({ id: tasks.id, boardOrder: tasks.boardOrder })
        .from(tasks)
        .where(eq(tasks.status, status))
        .orderBy(asc(tasks.boardOrder));
    }

    /** The ids of `mine`, in the order the column stores them. */
    function orderOf(rows: readonly { id: string }[], mine: readonly string[]) {
      const wanted = new Set(mine);
      return rows.map((row) => row.id).filter((id) => wanted.has(id));
    }

    /** A renumber leaves the whole column contiguous from 0. */
    function slots(rows: readonly { boardOrder: number }[]) {
      return rows.map((row) => row.boardOrder);
    }

    /** A team with a workstream declared on `eventId`, which the composite FK needs. */
    async function linkedTeam(eventId: string) {
      const { id: teamId } = await team();
      await db.insert(workstreams).values({ id: newId(), eventId, teamId });
      return teamId;
    }

    it("renumbers the column when the last card is dropped above the first", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const first = await seedTask(teamId, { eventId, boardOrder: 0, title: "First" });
      const second = await seedTask(teamId, { eventId, boardOrder: 1, title: "Second" });
      const third = await seedTask(teamId, { eventId, boardOrder: 2, title: "Third" });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${third.id}/status`)
        .send({ status: "todo", after: null });

      expect(response.status).toBe(200);
      // The top of the whole column, not just of this event's cards.
      expect(response.body.task).toMatchObject({ id: third.id, boardOrder: 0 });
      const rows = await column("todo");
      expect(orderOf(rows, [first.id, second.id, third.id])).toEqual([
        third.id,
        first.id,
        second.id,
      ]);
      expect(slots(rows)).toEqual(rows.map((_, index) => index));
    });

    it("lands a card directly after a named neighbour in its own column", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const first = await seedTask(teamId, { eventId, boardOrder: 0, title: "First" });
      const second = await seedTask(teamId, { eventId, boardOrder: 1, title: "Second" });
      const third = await seedTask(teamId, { eventId, boardOrder: 2, title: "Third" });
      signedInAs(actor);

      // The reported case: the second card dropped below the third becomes the
      // third, and the third becomes the second.
      const response = await request(app)
        .patch(`/api/tasks/${second.id}/status`)
        .send({ status: "todo", after: third.id });

      expect(response.status).toBe(200);
      expect(orderOf(await column("todo"), [first.id, second.id, third.id])).toEqual([
        first.id,
        third.id,
        second.id,
      ]);
    });

    it("renumbers the destination column only, leaving the source's gap alone", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const first = await seedTask(teamId, { eventId, boardOrder: 0, title: "First" });
      const second = await seedTask(teamId, { eventId, boardOrder: 1, title: "Second" });
      const leaving = await seedTask(teamId, { eventId, boardOrder: 2, title: "Leaving" });
      const anchor = await seedTask(teamId, {
        eventId,
        status: "in_progress",
        boardOrder: 0,
        title: "Anchor",
      });
      const below = await seedTask(teamId, {
        eventId,
        status: "in_progress",
        boardOrder: 1,
        title: "Below",
      });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${leaving.id}/status`)
        .send({ status: "in_progress", after: anchor.id });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ id: leaving.id, status: "in_progress" });
      expect(orderOf(await column("in_progress"), [anchor.id, leaving.id, below.id])).toEqual([
        anchor.id,
        leaving.id,
        below.id,
      ]);
      // A gap where the card left reads identically, because every reader orders
      // by value — so the source column is not rewritten.
      expect(
        (await column("todo")).filter((row) => row.id === first.id || row.id === second.id),
      ).toEqual([
        { id: first.id, boardOrder: 0 },
        { id: second.id, boardOrder: 1 },
      ]);
    });

    it("appends when the anchor is not in the destination column", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const first = await seedTask(teamId, { eventId, boardOrder: 0, title: "First" });
      const second = await seedTask(teamId, { eventId, boardOrder: 1, title: "Second" });
      const elsewhere = await seedTask(teamId, {
        eventId,
        status: "in_progress",
        boardOrder: 0,
        title: "Elsewhere",
      });
      signedInAs(actor);

      // A stale client naming a card in another column must not be able to move
      // this one to the top.
      const response = await request(app)
        .patch(`/api/tasks/${first.id}/status`)
        .send({ status: "todo", after: elsewhere.id });

      expect(response.status).toBe(200);
      expect(orderOf(await column("todo"), [first.id, second.id])).toEqual([second.id, first.id]);
    });

    // The backwards-compatible path: a caller that omits `after` gets exactly
    // the status change this endpoint has always made, slot untouched.
    it("leaves every slot alone when no anchor is given", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const staying = await seedTask(teamId, { eventId, boardOrder: 0, title: "Staying" });
      const leaving = await seedTask(teamId, { eventId, boardOrder: 7, title: "Leaving" });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${leaving.id}/status`)
        .send({ status: "in_progress" });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ id: leaving.id, boardOrder: 7 });
      expect((await column("todo")).find((row) => row.id === staying.id)).toEqual({
        id: staying.id,
        boardOrder: 0,
      });
      expect((await column("in_progress")).find((row) => row.id === leaving.id)).toEqual({
        id: leaving.id,
        boardOrder: 7,
      });
    });

    // The board is the column, and `/tasks` shows one column across every event,
    // so a card dropped between two other events' cards must stay there.
    it("honours an anchor that belongs to another event's board", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const other = await event({ title: "test-task-other-event" });
      const otherTeamId = (await team("test-task-other-team")).id;
      await db.insert(workstreams).values({ id: newId(), eventId: other.id, teamId: otherTeamId });
      const mine = await seedTask(teamId, { eventId, boardOrder: 0, title: "Mine" });
      const theirs = await seedTask(otherTeamId, {
        eventId: other.id,
        boardOrder: 1,
        title: "Theirs",
      });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${mine.id}/status`)
        .send({ status: "todo", after: theirs.id });

      expect(response.status).toBe(200);
      const rows = await column("todo");
      expect(orderOf(rows, [mine.id, theirs.id])).toEqual([theirs.id, mine.id]);
      expect(response.body.task.boardOrder).toBe(
        rows.find((row) => row.id === mine.id)?.boardOrder ?? -1,
      );
    });

    // A reorder re-writes the same status, so the timestamp must survive it —
    // re-dating finished work is not what a drop asks for.
    it("keeps completed_at when a card is reordered inside done", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const teamId = await linkedTeam(eventId);
      const finished = new Date("2026-05-01T00:00:00.000Z");
      const first = await seedTask(teamId, {
        eventId,
        status: "done",
        boardOrder: 0,
        completedAt: finished,
      });
      const second = await seedTask(teamId, {
        eventId,
        status: "done",
        boardOrder: 1,
        completedAt: finished,
      });
      const open = await seedTask(teamId, { eventId, boardOrder: 0, title: "Open" });
      signedInAs(actor);

      const reordered = await request(app)
        .patch(`/api/tasks/${second.id}/status`)
        .send({ status: "done", after: null });

      expect(reordered.status).toBe(200);
      expect(reordered.body.task.completedAt).toBe(finished.toISOString());
      expect(orderOf(await column("done"), [first.id, second.id])).toEqual([second.id, first.id]);

      // The ordinary way in still stamps, or the CHECK would reject the row.
      const completed = await request(app)
        .patch(`/api/tasks/${open.id}/status`)
        .send({ status: "done" });

      expect(completed.status).toBe(200);
      expect(completed.body.task.completedAt).not.toBeNull();
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
      const actor = await member("director", "director");
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).delete(`/api/tasks/${existing.id}`);

      expect(response.status).toBe(204);
      const remaining = await request(app).get(`/api/tasks/${existing.id}`);
      expect(remaining.status).toBe(404);
    });

    it("404s for an unknown id", async () => {
      const actor = await member("director", "director");
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
      const actor = await member("director", "director");
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
      const actor = await member("director", "director");
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
      const actor = await member("director", "director");
      signedInAs(actor);

      const response = await request(app).post("/api/tasks/bulk").send({ tasks: [] });

      expect(response.status).toBe(422);
    });
  });

  describe("linking tasks to events", () => {
    it("links a task to an event, and the event's counts and embed see it", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      signedInAs(actor);

      const created = await request(app)
        .post("/api/tasks")
        .send({ eventId, title: "Print flyers" });

      expect(created.status).toBe(201);
      expect(created.body.task.eventId).toBe(eventId);
      const detail = await request(app).get(`/api/events/${eventId}`).query({ include: "tasks" });
      expect(detail.status).toBe(200);
      expect(detail.body.event.taskCounts).toEqual({ todo: 1, inProgress: 0, blocked: 0, done: 0 });
      expect(detail.body.event.tasks.map((task: { id: string }) => task.id)).toEqual([
        created.body.task.id,
      ]);
    });

    it("declares the team's workstream when a task pairs an event with a team", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const { id: teamId } = await team();
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ eventId, teamId, title: "Film the keynote" });

      expect(response.status).toBe(201);
      expect(await workstreamTeams(eventId)).toEqual([teamId]);
      // The event side agrees: GET /events?teamId= is answered from workstreams.
      const byTeam = await request(app).get("/api/events").query({ teamId });
      expect(byTeam.body.items.map((item: { id: string }) => item.id)).toEqual([eventId]);
    });

    it("reuses the workstream for a second task on the same pair", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const { id: teamId } = await team();
      signedInAs(actor);

      const first = await request(app).post("/api/tasks").send({ eventId, teamId, title: "One" });
      const second = await request(app).post("/api/tasks").send({ eventId, teamId, title: "Two" });

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await workstreamTeams(eventId)).toEqual([teamId]);
    });

    it("422s EVENT_NOT_FOUND on an unknown event rather than surfacing an FK violation", async () => {
      const actor = await member("officer", "officer");
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks")
        .send({ eventId: UNKNOWN_ID, title: "Orphan" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
    });

    it.each([
      ["cancelled", { status: "cancelled" as const }],
      ["above the caller's tier", { minTier: 2 }],
    ])(
      "422s EVENT_NOT_FOUND for an event that is %s — the same answer as a missing one",
      async (_label, overrides) => {
        const actor = await member("officer", "officer");
        const { id: eventId } = await event(overrides);
        signedInAs(actor);

        const response = await request(app).post("/api/tasks").send({ eventId, title: "Hidden" });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
      },
    );

    it("moves a task to another team on the same event instead of 500ing on the composite FK", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const media = await team("test-task-media");
      const marketing = await team("test-task-marketing");
      await db.insert(workstreams).values({ id: newId(), eventId, teamId: media.id });
      const existing = await seedTask(media.id, { eventId });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ teamId: marketing.id });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ eventId, teamId: marketing.id });
      expect(await workstreamTeams(eventId)).toEqual([media.id, marketing.id].sort());
    });

    it("links a standing task to an event, keeping its team", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const { id: teamId } = await team();
      const existing = await seedTask(teamId);
      signedInAs(actor);

      const response = await request(app).patch(`/api/tasks/${existing.id}`).send({ eventId });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ eventId, teamId });
      expect(await workstreamTeams(eventId)).toEqual([teamId]);
    });

    it("unlinks with eventId null and leaves the team alone", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const { id: teamId } = await team();
      await db.insert(workstreams).values({ id: newId(), eventId, teamId });
      const existing = await seedTask(teamId, { eventId });
      signedInAs(actor);

      const response = await request(app)
        .patch(`/api/tasks/${existing.id}`)
        .send({ eventId: null });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ eventId: null, teamId });
    });

    it("404s a link change on an unknown task", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      signedInAs(actor);

      const response = await request(app).patch(`/api/tasks/${UNKNOWN_ID}`).send({ eventId });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TASK_NOT_FOUND");
    });

    it("declares each distinct workstream once for a bulk batch", async () => {
      const actor = await member("director", "director");
      const { id: eventId } = await event();
      const media = await team("test-task-media");
      const marketing = await team("test-task-marketing");
      signedInAs(actor);

      const response = await request(app)
        .post("/api/tasks/bulk")
        .send({
          tasks: [
            { eventId, teamId: media.id, title: "Film" },
            { eventId, teamId: media.id, title: "Edit" },
            { eventId, teamId: marketing.id, title: "Post" },
          ],
        });

      expect(response.status).toBe(201);
      expect(await workstreamTeams(eventId)).toEqual([media.id, marketing.id].sort());
    });

    it("filters GET /api/tasks by eventId", async () => {
      const actor = await member("officer", "officer");
      const oweek = await event({ title: "test-task-oweek" });
      const gala = await event({ title: "test-task-gala" });
      signedInAs(actor);
      await request(app).post("/api/tasks").send({ eventId: oweek.id, title: "Book the booth" });
      await request(app).post("/api/tasks").send({ eventId: gala.id, title: "Book the hall" });
      await request(app).post("/api/tasks").send({ title: "Standing work" });

      const response = await request(app).get("/api/tasks").query({ eventId: oweek.id });

      expect(response.status).toBe(200);
      expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
        "Book the booth",
      ]);
    });

    it("filters GET /api/tasks/overdue by eventId", async () => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event();
      const past = new Date(Date.now() - HOUR).toISOString();
      signedInAs(actor);
      await request(app)
        .post("/api/tasks")
        .send({ eventId, title: "Late for the event", dueAt: past });
      await request(app).post("/api/tasks").send({ title: "Late elsewhere", dueAt: past });

      const response = await request(app).get("/api/tasks/overdue").query({ eventId });

      expect(response.status).toBe(200);
      expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
        "Late for the event",
      ]);
    });
  });
});
