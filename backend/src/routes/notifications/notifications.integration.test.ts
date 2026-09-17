import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, notifications } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

describe("/api/notifications (integration)", () => {
  const db = nodeDb();

  async function member(name: string) {
    const authUserId = `test-notif-${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${name}@example.com`}, true, now(), now())
    `);
    const [row] = await db
      .insert(appUsers)
      .values({ id: newId(), authUserId, role: "officer" })
      .returning();
    return row!;
  }

  async function notify(userId: string, body: string, readAt: Date | null = null) {
    const [row] = await db
      .insert(notifications)
      .values({ id: newId(), userId, kind: "mention", body, readAt })
      .returning();
    return row!;
  }

  function signInAs(actor: { authUserId: string }) {
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: "actor@example.com" } });
  }

  beforeEach(async () => {
    getSession.mockReset();
    await db.execute(sql`
      DELETE FROM "notification" WHERE "user_id" IN (
        SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE 'test-notif-%'
      )
    `);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-notif-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-notif-%'`);
  });

  afterAll(async () => {
    await db.execute(sql`
      DELETE FROM "notification" WHERE "user_id" IN (
        SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE 'test-notif-%'
      )
    `);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-notif-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-notif-%'`);
    await closeNodeDb();
  });

  describe("GET /api/notifications", () => {
    it("401s without a session", async () => {
      getSession.mockResolvedValue(null);
      expect((await request(app).get("/api/notifications")).status).toBe(401);
    });

    it("returns only the caller's notifications, newest first, with an unread count", async () => {
      const actor = await member("actor");
      const other = await member("other");
      await notify(actor.id, "older", new Date());
      await notify(actor.id, "newer");
      await notify(other.id, "not yours");
      signInAs(actor);

      const response = await request(app).get("/api/notifications");

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(2);
      expect(response.body.notifications[0].body).toBe("newer");
      expect(response.body.unreadCount).toBe(1);
    });

    it("filters to unread only when unreadOnly=true", async () => {
      const actor = await member("actor");
      await notify(actor.id, "read", new Date());
      await notify(actor.id, "unread");
      signInAs(actor);

      const response = await request(app).get("/api/notifications?unreadOnly=true");

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].body).toBe("unread");
    });

    it("returns read and unread when unreadOnly=false", async () => {
      const actor = await member("actor");
      await notify(actor.id, "read", new Date());
      await notify(actor.id, "unread");
      signInAs(actor);

      const response = await request(app).get("/api/notifications?unreadOnly=false");

      expect(response.status).toBe(200);
      expect(response.body.notifications).toHaveLength(2);
    });
  });

  describe("PATCH /api/notifications/:id/read", () => {
    it("marks an unread notification as read", async () => {
      const actor = await member("actor");
      const row = await notify(actor.id, "hello");
      signInAs(actor);

      const response = await request(app).patch(`/api/notifications/${row.id}/read`);

      expect(response.status).toBe(200);
      expect(response.body.notification.readAt).not.toBeNull();
      const [stored] = await db.select().from(notifications).where(eq(notifications.id, row.id));
      expect(stored!.readAt).not.toBeNull();
    });

    it("is idempotent on an already-read notification", async () => {
      const actor = await member("actor");
      const row = await notify(actor.id, "hello", new Date());
      signInAs(actor);

      const response = await request(app).patch(`/api/notifications/${row.id}/read`);

      expect(response.status).toBe(200);
      expect(response.body.notification.id).toBe(row.id);
    });

    it("404s on another member's notification", async () => {
      const actor = await member("actor");
      const other = await member("other");
      const row = await notify(other.id, "not yours");
      signInAs(actor);

      const response = await request(app).patch(`/api/notifications/${row.id}/read`);

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/notifications/read-all", () => {
    it("marks every unread notification as read, only for the caller", async () => {
      const actor = await member("actor");
      const other = await member("other");
      await notify(actor.id, "one");
      await notify(actor.id, "two");
      const otherUnread = await notify(other.id, "not yours");
      signInAs(actor);

      const response = await request(app).patch("/api/notifications/read-all");

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      const [stillUnread] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, otherUnread.id));
      expect(stillUnread!.readAt).toBeNull();
    });
  });
});
