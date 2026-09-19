import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  appUsers,
  events,
  expenses,
  notifications,
  taskAssignees,
  tasks,
  teams,
} from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

// Nothing in any real or demo dataset should ever have a starts_at this far
// out, so fixture events with this date always sort first (starts_at DESC) —
// the cursor-paging test needs that to isolate itself from ambient rows.
const FAR_FUTURE = new Date("9999-01-01T00:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("/api/events", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `test-event-${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${authUserId}@example.com`}, true, now(), now())
    `);
    const [row] = await db.insert(appUsers).values({ id: newId(), authUserId, role }).returning();
    return row!;
  }

  function signedInAs(actor: { authUserId: string }) {
    getSession.mockResolvedValue({
      user: { id: actor.authUserId, email: "actor@example.com", emailVerified: true },
    });
  }

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({ id: newId(), title: "test-event-fixture", startsAt: new Date(), ...overrides })
      .returning();
    return row!;
  }

  /** A task on `eventId`, owned by `userIds` through the junction. */
  async function seedTask(
    eventId: string,
    userIds: readonly string[],
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), eventId, title: "test-event-task", ...overrides })
      .returning();
    if (userIds.length > 0) {
      await db.insert(taskAssignees).values(userIds.map((userId) => ({ taskId: row!.id, userId })));
    }
    return row!;
  }

  // task.event_id cascades; expense.event_id is RESTRICT (the ledger must
  // survive an event delete), so expenses go first.
  async function cleanup() {
    await db.execute(sql`
      DELETE FROM "expense" WHERE "event_id" IN (SELECT "id" FROM "event" WHERE "title" LIKE 'test-event-%')
    `);
    await db.execute(sql`DELETE FROM "event" WHERE "title" LIKE 'test-event-%'`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-event-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-event-%'`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await closeNodeDb();
  });

  describe("GET /api/events/:id", () => {
    it("404s a tier miss rather than 403ing — a 403 would confirm the event exists", async () => {
      const officer = await member("officer", "officer");
      const managementOnly = await seedEvent({ title: "test-event-mgmt-only", minTier: 2 });
      signedInAs(officer);

      const response = await request(app).get(`/api/events/${managementOnly.id}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
    });
  });

  describe("GET /api/events", () => {
    it("pages a keyset cursor over three events sharing one starts_at, returning each exactly once", async () => {
      const officer = await member("officer", "officer");
      const [a, b, c] = await Promise.all([
        seedEvent({ title: "test-event-cursor-a", startsAt: FAR_FUTURE }),
        seedEvent({ title: "test-event-cursor-b", startsAt: FAR_FUTURE }),
        seedEvent({ title: "test-event-cursor-c", startsAt: FAR_FUTURE }),
      ]);
      signedInAs(officer);

      const page1 = await request(app).get("/api/events?limit=2");
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await request(app).get(
        `/api/events?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      );
      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBeGreaterThanOrEqual(1);

      // FAR_FUTURE outranks everything else in the table, so the first three
      // rows returned overall are exactly {a, b, c} — no other row can be
      // interleaved ahead of them.
      const seenIds = [...page1.body.items, ...page2.body.items]
        .slice(0, 3)
        .map((item: { id: string }) => item.id);
      expect(new Set(seenIds)).toEqual(new Set([a.id, b.id, c.id]));
      expect(seenIds).toHaveLength(new Set(seenIds).size); // no duplicate across pages
    });

    it("order=asc returns the soonest event first and pages that direction too", async () => {
      const officer = await member("officer", "officer");
      // A private window at the far end of the calendar, for the same reason
      // the cursor test uses FAR_FUTURE: nothing ambient can interleave.
      const near = new Date("9998-01-01T00:00:00Z");
      const far = new Date("9998-01-02T00:00:00Z");
      const [first, second] = await Promise.all([
        seedEvent({ title: "test-event-asc-first", startsAt: near }),
        seedEvent({ title: "test-event-asc-second", startsAt: far }),
      ]);
      signedInAs(officer);

      const response = await request(app).get(
        `/api/events?from=${near.toISOString()}&limit=2&order=asc`,
      );
      expect(response.status).toBe(200);
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
        first.id,
        second.id,
      ]);

      // The cursor is a position in THIS order, so the next page continues
      // forward rather than jumping back to the far end of the table.
      const head = await request(app).get(
        `/api/events?from=${near.toISOString()}&limit=1&order=asc`,
      );
      expect(head.body.items.map((item: { id: string }) => item.id)).toEqual([first.id]);
      expect(head.body.nextCursor).toBeTruthy();

      const page = await request(app).get(
        `/api/events?from=${near.toISOString()}&limit=1&order=asc&cursor=${encodeURIComponent(head.body.nextCursor)}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.items[0].id).toBe(second.id);
    });

    it("includes blocked in taskCounts and keeps overdueCount as a sibling, not a fifth bucket", async () => {
      const officer = await member("officer", "officer");
      const event = await seedEvent({ title: "test-event-counts" });
      await db.insert(tasks).values([
        { id: newId(), eventId: event.id, title: "t1", status: "todo" },
        { id: newId(), eventId: event.id, title: "t2", status: "in_progress" },
        { id: newId(), eventId: event.id, title: "t3", status: "blocked" },
        { id: newId(), eventId: event.id, title: "t4", status: "blocked" },
        { id: newId(), eventId: event.id, title: "t5", status: "done", completedAt: new Date() },
        // Overdue: not done, due in the past. Also counted in `todo` above.
        {
          id: newId(),
          eventId: event.id,
          title: "t6",
          status: "todo",
          dueAt: new Date(Date.now() - HOUR),
        },
      ]);
      signedInAs(officer);

      const response = await request(app).get(`/api/events/${event.id}`);

      expect(response.status).toBe(200);
      expect(response.body.event.taskCounts).toEqual({
        todo: 2,
        inProgress: 1,
        blocked: 2,
        done: 1,
      });
      expect(response.body.event.overdueCount).toBe(1);
      expect(response.body.event.taskCounts).not.toHaveProperty("overdue");
    });

    it("excludes a cancelled event by default, but returns it when status=cancelled is explicit", async () => {
      const officer = await member("officer", "officer");
      const cancelled = await seedEvent({ title: "test-event-cancelled", status: "cancelled" });
      signedInAs(officer);

      const defaultList = await request(app).get("/api/events?limit=100");
      expect(defaultList.body.items.some((item: { id: string }) => item.id === cancelled.id)).toBe(
        false,
      );

      const explicit = await request(app).get("/api/events?limit=100&status=cancelled");
      expect(explicit.body.items.some((item: { id: string }) => item.id === cancelled.id)).toBe(
        true,
      );
    });
  });

  describe("PATCH /api/events/:id", () => {
    it("403s a non-owner officer", async () => {
      const owner = await member("owner", "officer");
      const other = await member("other", "officer");
      const event = await seedEvent({ title: "test-event-patch-403", owner: owner.id });
      signedInAs(other);

      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({ title: "hijack" });

      expect(response.status).toBe(403);
    });

    it("200s the owning officer, even at tier 0", async () => {
      const owner = await member("owner2", "officer");
      const event = await seedEvent({ title: "test-event-patch-200", owner: owner.id });
      signedInAs(owner);

      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({ title: "Renamed by owner" });

      expect(response.status).toBe(200);
      expect(response.body.event.title).toBe("Renamed by owner");
    });

    it("returns 422 with a field message, not a 500, when startsAt moves past a stored endsAt", async () => {
      const owner = await member("owner3", "officer");
      const event = await seedEvent({
        title: "test-event-patch-dates",
        owner: owner.id,
        startsAt: new Date("2026-06-01T00:00:00Z"),
        endsAt: new Date("2026-06-02T00:00:00Z"),
      });
      signedInAs(owner);

      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({ startsAt: "2026-06-03T00:00:00Z" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.fields.endsAt).toBeDefined();
    });
  });

  describe("PATCH /api/events/:id/status", () => {
    it("allows every legal hop and rejects every illegal one", async () => {
      const lead = await member("lead", "director");
      signedInAs(lead);

      const legal: [string, string][] = [
        ["planning", "live"],
        ["live", "wrapped"],
        ["wrapped", "live"],
      ];
      for (const [from, to] of legal) {
        const event = await seedEvent({
          title: `test-event-transition-${from}-${to}`,
          status: from as never,
        });
        const response = await request(app)
          .patch(`/api/events/${event.id}/status`)
          .send({ status: to });
        expect(response.status).toBe(200);
        expect(response.body.status).toBe(to);
      }

      const illegal: [string, string][] = [
        ["planning", "wrapped"],
        ["wrapped", "planning"],
        ["live", "planning"],
      ];
      for (const [from, to] of illegal) {
        const event = await seedEvent({
          title: `test-event-illegal-${from}-${to}`,
          status: from as never,
        });
        const response = await request(app)
          .patch(`/api/events/${event.id}/status`)
          .send({ status: to });
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("refuses to wrap while an expense is pending", async () => {
      const lead = await member("lead2", "director");
      const event = await seedEvent({ title: "test-event-wrap-blocked", status: "live" });
      await db.insert(expenses).values({
        id: newId(),
        eventId: event.id,
        amountCents: 100,
        description: "x",
        category: "other",
      });
      signedInAs(lead);

      const response = await request(app)
        .patch(`/api/events/${event.id}/status`)
        .send({ status: "wrapped" });

      expect(response.status).toBe(409);
      expect(response.body.blockers.length).toBeGreaterThan(0);
    });
  });

  describe("DELETE /api/events/:id", () => {
    it("allows the Events-team lead, not just the president", async () => {
      const director = await member("events-lead", "director");
      const outsider = await member("outsider", "secretary");

      // "Events" is a unique team name (possibly demo-seeded already) — reuse
      // it and restore its lead if it exists, otherwise create it and drop it
      // in cleanup, so this test is independent of whether SEED_DEMO ran.
      const [existing] = await db
        .select()
        .from(teams)
        .where(sql`"name" = 'Events'`)
        .limit(1);
      const weCreatedTeam = !existing;
      const originalLead = existing?.lead ?? null;
      const eventsTeam = existing
        ? existing
        : (
            await db
              .insert(teams)
              .values({ id: newId(), name: "Events", lead: director.id })
              .returning()
          )[0]!;
      if (existing) {
        await db
          .update(teams)
          .set({ lead: director.id })
          .where(sql`"id" = ${eventsTeam.id}`);
      }

      const event = await seedEvent({ title: "test-event-team-lead-cancel" });
      await db.execute(sql`
        INSERT INTO "workstream" ("id", "event_id", "team_id") VALUES (${newId()}, ${event.id}, ${eventsTeam.id})
      `);

      signedInAs(outsider);
      const forbidden = await request(app).delete(`/api/events/${event.id}`);

      signedInAs(director);
      const allowed = await request(app).delete(`/api/events/${event.id}`);

      // DELETE only cancels the event (soft delete) — the workstream row
      // survives, so it must go before the team can (team_id is RESTRICT).
      await db.execute(
        sql`DELETE FROM "workstream" WHERE "event_id" = ${event.id} AND "team_id" = ${eventsTeam.id}`,
      );
      if (weCreatedTeam) {
        await db.delete(teams).where(sql`"id" = ${eventsTeam.id}`);
      } else {
        await db
          .update(teams)
          .set({ lead: originalLead })
          .where(sql`"id" = ${eventsTeam.id}`);
      }

      expect(forbidden.status).toBe(403);
      expect(allowed.status).toBe(204);
    });

    it("is idempotent — cancelling an already-cancelled event still 204s", async () => {
      const president = await member("president", "president");
      const event = await seedEvent({ title: "test-event-double-cancel" });
      signedInAs(president);

      const first = await request(app).delete(`/api/events/${event.id}`);
      const second = await request(app).delete(`/api/events/${event.id}`);

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
    });

    it("releases the unspent allocation down to committed (paid) spend on cancel", async () => {
      const president = await member("president2", "president");
      const event = await seedEvent({ title: "test-event-cancel-release", allocationCents: 500 });
      await db.insert(expenses).values({
        id: newId(),
        eventId: event.id,
        amountCents: 200,
        description: "settled",
        category: "other",
        status: "paid",
        decidedAt: new Date(),
        paidAt: new Date(),
      });
      signedInAs(president);

      const response = await request(app).delete(`/api/events/${event.id}`);
      expect(response.status).toBe(204);

      const [row] = await db
        .select({ allocationCents: events.allocationCents })
        .from(events)
        .where(sql`id = ${event.id}`);
      expect(row?.allocationCents).toBe(200);
    });
  });

  /**
   * The event routes reach task ownership through `task_assignee`, so these are
   * the tests that would fail if one of them still read the dropped column.
   */
  describe("task assignment from the event side", () => {
    it("notifies every assignee of the event's open work, once each", async () => {
      const president = await member("president", "president");
      const director = await member("director", "director");
      const secretary = await member("secretary", "secretary");
      const event = await seedEvent({ title: "test-event-assignee-fanout" });
      // Two tasks, three links, two of them on one task and one member holding
      // both: the fan-out must dedupe across the whole event, not per task.
      await seedTask(event.id, [director.id, secretary.id]);
      await seedTask(event.id, [director.id]);
      // Done work is not "still waiting on", so its owner hears nothing.
      await seedTask(event.id, [president.id], {
        status: "done",
        completedAt: new Date(),
      });
      signedInAs(president);

      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({ startsAt: new Date(Date.now() + HOUR).toISOString() });

      expect(response.status).toBe(200);
      const sent = await db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(sql`"entity_id" = ${event.id} AND "kind" = 'event_date_changed'`);
      expect(sent.map((row) => row.userId).sort()).toEqual([director.id, secretary.id].sort());
    });

    it("blocks raising minTier above a co-assignee's tier, not just the first assignee", async () => {
      const president = await member("president", "president");
      const director = await member("director", "director");
      const officer = await member("officer", "officer");
      const event = await seedEvent({ title: "test-event-tier-escalation" });
      // Director is the actor (tier 1). The task pairs a tier-2 owner with a
      // tier-0 one, so only a read that checks EVERY link catches the lower.
      await seedTask(event.id, [president.id, officer.id]);
      signedInAs(director);

      const response = await request(app).patch(`/api/events/${event.id}`).send({ minTier: 1 });

      expect(response.status).toBe(422);
      expect(response.body.error.fields.minTier).toBeDefined();
    });

    it("allows raising minTier when every assignee already meets it", async () => {
      const director = await member("director", "director");
      const secretary = await member("secretary", "secretary");
      const event = await seedEvent({ title: "test-event-tier-escalation-ok" });
      await seedTask(event.id, [director.id, secretary.id]);
      signedInAs(director);

      const response = await request(app).patch(`/api/events/${event.id}`).send({ minTier: 1 });

      expect(response.status).toBe(200);
      expect(response.body.event.minTier).toBe(1);
    });

    it("embeds every assignee of each task on GET /api/events/:id", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      const event = await seedEvent({ title: "test-event-embed-assignees" });
      const shared = await seedTask(event.id, [officer.id, director.id]);
      signedInAs(officer);

      const response = await request(app)
        .get(`/api/events/${event.id}`)
        .query({ include: "tasks" });

      expect(response.status).toBe(200);
      expect(response.body.event.tasks).toHaveLength(1);
      expect(response.body.event.tasks[0]).toMatchObject({
        id: shared.id,
        assigneeIds: [officer.id, director.id],
      });
    });
  });

  describe("GET /api/calendar", () => {
    it("lists each task's full assignee set, not one representative", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      const event = await seedEvent({ title: "test-event-calendar-assignees" });
      const shared = await seedTask(event.id, [officer.id, director.id], {
        dueAt: new Date(Date.now() + HOUR),
      });
      signedInAs(officer);

      const response = await request(app)
        .get("/api/calendar")
        .query({
          from: new Date().toISOString(),
          to: new Date(Date.now() + 2 * HOUR).toISOString(),
        });

      expect(response.status).toBe(200);
      const item = response.body.items.find(
        (candidate: { kind: string; id: string }) =>
          candidate.kind === "task" && candidate.id === shared.id,
      );
      expect(item.assigneeIds.sort()).toEqual([officer.id, director.id].sort());
    });

    it("moves an event when its dates are patched, and warns about stranded tasks", async () => {
      const owner = await member("owner", "officer");
      signedInAs(owner);
      const event = await seedEvent({
        title: "test-event-calendar-move",
        owner: owner.id,
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 3 * HOUR),
      });
      // Inside the event's window as it stands, so moving the event earlier is
      // what leaves it behind.
      await seedTask(event.id, [], { dueAt: new Date(Date.now() + 2 * HOUR) });

      const moved = new Date(Date.now() - 2 * HOUR);
      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({
          startsAt: moved.toISOString(),
          endsAt: new Date(moved.getTime() + HOUR).toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body.event.startsAt).toBe(moved.toISOString());
      expect(response.body.warnings).toEqual(["1 task now falls after the event date"]);
    });

    it("422s an end before the start, which is the one invalid pair a move can send", async () => {
      const owner = await member("owner", "officer");
      signedInAs(owner);
      const event = await seedEvent({
        title: "test-event-calendar-inverted",
        owner: owner.id,
        startsAt: new Date(Date.now() + 2 * HOUR),
      });

      const response = await request(app)
        .patch(`/api/events/${event.id}`)
        .send({ endsAt: new Date(Date.now() + HOUR).toISOString() });

      expect(response.status).toBe(422);
      expect(response.body.error.fields.endsAt).toEqual(["endsAt must not precede startsAt"]);
    });

    it("returns an event that started before the range but ends inside it", async () => {
      const officer = await member("officer", "officer");
      signedInAs(officer);
      const from = new Date(Date.now() + HOUR);
      const to = new Date(from.getTime() + 6 * HOUR);
      const straddling = await seedEvent({
        title: "test-event-calendar-straddle",
        startsAt: new Date(from.getTime() - 2 * HOUR),
        endsAt: new Date(from.getTime() + HOUR),
      });
      // Over and done before the window opens.
      const finished = await seedEvent({
        title: "test-event-calendar-finished",
        startsAt: new Date(from.getTime() - 3 * HOUR),
        endsAt: new Date(from.getTime() - HOUR),
      });
      // No end time: a point event occupies its start instant alone.
      const point = await seedEvent({
        title: "test-event-calendar-point",
        startsAt: new Date(from.getTime() - HOUR),
        endsAt: null,
      });

      const response = await request(app)
        .get("/api/calendar")
        .query({ from: from.toISOString(), to: to.toISOString(), include: "events" });

      expect(response.status).toBe(200);
      const ids = response.body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(straddling.id);
      expect(ids).not.toContain(finished.id);
      expect(ids).not.toContain(point.id);
    });
  });
});
