import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, events, tasks } from "../../db/schema/index.js";

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

  // task.event_id cascades, so deleting the fixture events is enough.
  async function cleanup() {
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
});
