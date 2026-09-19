import type { Role } from "@ctp/shared";
import { eq, isNull, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, tasks } from "../../db/schema/index.js";

// The sweep itself is not session-authenticated — the bearer secret is its whole
// guard — but the task endpoints used to set up and read back a cycle are.
const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const HOUR = 60 * 60 * 1000;

/** The secret the running app captured; the shell sets it for this suite. */
const SECRET = process.env.CRON_SECRET ?? "test-cron-secret";

const OVERDUE = new Date(Date.now() - HOUR);
const FUTURE = new Date(Date.now() + HOUR);

describe("/api/cron/reminders", () => {
  const db = nodeDb();
  let actor: { id: string; authUserId: string };

  /**
   * The cron guard is the last thing between a public URL and a write to every
   * task row, so it is asserted before anything else here.
   */
  it("refuses a caller without the secret", async () => {
    const anonymous = await request(app).get("/api/cron/reminders");
    const wrong = await request(app)
      .get("/api/cron/reminders")
      .set("authorization", "Bearer not-the-secret");

    expect(anonymous.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  /** A standing task: both parents null is legal and needs no fixture team. */
  async function seedTask(overrides: Partial<typeof tasks.$inferInsert> = {}) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), title: "test-cron-task", ...overrides })
      .returning();
    return row!;
  }

  async function member(role: Role = "officer") {
    const authUserId = "test-cron-actor";
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, 'Cron Actor', ${`${authUserId}@example.com`}, true, now(), now())
    `);
    const [row] = await db.insert(appUsers).values({ id: newId(), authUserId, role }).returning();
    return row!;
  }

  async function sweep() {
    return request(app).get("/api/cron/reminders").set("authorization", `Bearer ${SECRET}`);
  }

  /** The stored row, including the backend-only escalation marker. */
  async function stored(id: string) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row!;
  }

  async function cleanup() {
    await db.execute(sql`DELETE FROM "task" WHERE "title" LIKE 'test-cron-%'`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-cron-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-cron-%'`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await cleanup();
    // `db:seed` ships overdue work of its own, and the sweep is global by design.
    // Marking everything already overdue leaves this suite's fixtures as the only
    // rows a sweep in these tests can touch, so the reported counts are exact.
    // Only the operational marker moves; no priority is rewritten.
    await db
      .update(tasks)
      .set({ overdueEscalatedAt: new Date() })
      .where(
        sql`${tasks.status} <> 'done' AND ${tasks.dueAt} < now() AND ${isNull(tasks.overdueEscalatedAt)}`,
      );

    actor = await member();
    getSession.mockResolvedValue({
      user: { id: actor.authUserId, email: "actor@example.com", emailVerified: true },
    });
  });

  afterAll(async () => {
    await cleanup();
    await closeNodeDb();
  });

  it("escalates only open tasks past their deadline, once each", async () => {
    const open = await seedTask({ title: "test-cron-open", dueAt: OVERDUE });
    const done = await seedTask({
      title: "test-cron-done",
      dueAt: OVERDUE,
      status: "done",
      completedAt: new Date(),
      priority: "low",
    });
    const future = await seedTask({ title: "test-cron-future", dueAt: FUTURE });
    const undated = await seedTask({ title: "test-cron-undated" });

    const response = await sweep();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, escalated: 1, sent: 0 });

    const escalated = await stored(open.id);
    expect(escalated.priority).toBe("urgent");
    expect(escalated.overdueEscalatedAt).toBeInstanceOf(Date);

    // The done task is the interesting one: its deadline passed, but the work is
    // finished, so it is neither escalated nor marked.
    expect(await stored(done.id)).toMatchObject({ priority: "low", overdueEscalatedAt: null });
    expect(await stored(future.id)).toMatchObject({
      priority: "medium",
      overdueEscalatedAt: null,
    });
    // NULL due_at is excluded by the comparison itself, not by a second filter.
    expect(await stored(undated.id)).toMatchObject({
      priority: "medium",
      overdueEscalatedAt: null,
    });

    // The marker is operational state: it never reaches the wire.
    const readBack = await request(app).get(`/api/tasks/${open.id}`);
    expect(readBack.status).toBe(200);
    expect(readBack.body.task.priority).toBe("urgent");
    expect(readBack.body.task).not.toHaveProperty("overdueEscalatedAt");

    // A second sweep is a no-op: the marker is what makes this once per cycle.
    const second = await sweep();
    expect(second.body.escalated).toBe(0);
    expect((await stored(open.id)).priority).toBe("urgent");
  });

  it("leaves a user's post-escalation priority change alone", async () => {
    const task = await seedTask({ title: "test-cron-override", dueAt: OVERDUE });
    await sweep();
    expect((await stored(task.id)).priority).toBe("urgent");

    // A priority-only edit is not a new overdue cycle, so the marker stands and
    // tonight's sweep must not put `urgent` back.
    await db.update(tasks).set({ priority: "low" }).where(eq(tasks.id, task.id));
    const response = await sweep();

    expect(response.body.escalated).toBe(0);
    expect((await stored(task.id)).priority).toBe("low");
    expect((await stored(task.id)).overdueEscalatedAt).not.toBeNull();
  });

  it("starts a new cycle when the deadline moves", async () => {
    const task = await seedTask({ title: "test-cron-moved", dueAt: OVERDUE });
    await sweep();
    await db.update(tasks).set({ priority: "low" }).where(eq(tasks.id, task.id));

    // The route, not the fixture: moving the deadline is what clears the marker.
    const moved = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .send({ dueAt: FUTURE.toISOString() });
    expect(moved.status).toBe(200);
    expect((await stored(task.id)).overdueEscalatedAt).toBeNull();

    // Not yet overdue again, so nothing happens.
    expect((await sweep()).body.escalated).toBe(0);

    await db.update(tasks).set({ dueAt: OVERDUE }).where(eq(tasks.id, task.id));
    expect((await sweep()).body.escalated).toBe(1);
    expect((await stored(task.id)).priority).toBe("urgent");
  });

  it("starts a new cycle when a completed task is reopened", async () => {
    const task = await seedTask({ title: "test-cron-reopened", dueAt: OVERDUE });
    await sweep();
    expect((await stored(task.id)).priority).toBe("urgent");

    const closed = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .send({ status: "done" });
    expect(closed.status).toBe(200);
    // Finishing a task keeps the marker: reopening is what starts the next cycle.
    expect((await stored(task.id)).overdueEscalatedAt).not.toBeNull();
    expect((await sweep()).body.escalated).toBe(0);

    const reopened = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .send({ status: "todo" });
    expect(reopened.status).toBe(200);
    expect((await stored(task.id)).overdueEscalatedAt).toBeNull();

    expect((await sweep()).body.escalated).toBe(1);
    expect((await stored(task.id)).priority).toBe("urgent");
  });

  it("keeps the marker on an open-to-open move", async () => {
    const task = await seedTask({ title: "test-cron-inprogress", dueAt: OVERDUE });
    await sweep();

    const moved = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .send({ status: "in_progress" });

    expect(moved.status).toBe(200);
    expect((await stored(task.id)).overdueEscalatedAt).not.toBeNull();
    expect((await sweep()).body.escalated).toBe(0);
  });

  it("lets the due-date reset win when a patch moves both fields", async () => {
    const task = await seedTask({
      title: "test-cron-both",
      dueAt: OVERDUE,
      status: "done",
      completedAt: new Date(),
      overdueEscalatedAt: new Date(),
    });

    // Reopening alone would clear the marker through the stored-status CASE, and a
    // moved deadline clears it outright; the patch moves both, so it ends up null.
    const patched = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .send({ dueAt: OVERDUE.toISOString(), status: "todo" });

    expect(patched.status).toBe(200);
    expect((await stored(task.id)).overdueEscalatedAt).toBeNull();
  });

  it("leaves a task created with an already-past deadline for the next sweep", async () => {
    // Creation writes no marker, so an overdue new task is escalated by the very
    // next sweep rather than being skipped as "already handled".
    const created = await request(app)
      .post("/api/tasks")
      .send({ title: "test-cron-created-late", dueAt: OVERDUE.toISOString() });

    expect(created.status).toBe(201);
    expect((await stored(created.body.task.id)).overdueEscalatedAt).toBeNull();
    expect((await sweep()).body.escalated).toBe(1);
    expect((await stored(created.body.task.id)).priority).toBe("urgent");
  });
});
