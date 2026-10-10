import type { Role } from "@ctp/shared";
import { mentionToken } from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  auditLog,
  chanMembers,
  channels,
  events,
  messages,
  notifications,
  taskAssignees,
  tasks,
  teams,
} from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

/** Every fixture is prefixed so cleanup never touches the base or demo seed. */
const PREFIX = "test-threads-";
const UNKNOWN_ID = "018f3a4b-0000-7000-8000-0000000000ff";
const DAY = 24 * 60 * 60 * 1000;

describe("/api/threads (integration)", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `${PREFIX}${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${authUserId}@example.com`}, true, now(), now())
    `);
    const id = newId();
    await db.execute(sql`
      INSERT INTO "app_user" ("id", "auth_user_id", "role") VALUES (${id}, ${authUserId}, ${role})
    `);
    return { id, authUserId };
  }

  function signIn(actor: { authUserId: string }) {
    getSession.mockResolvedValue({
      user: { id: actor.authUserId, email: `${actor.authUserId}@example.com` },
    });
  }

  async function teamThread(slug: string, minTier = 0) {
    const [team] = await db
      .insert(teams)
      .values({ id: newId(), name: `${PREFIX}${slug}` })
      .returning();
    const [thread] = await db
      .insert(channels)
      .values({ id: newId(), teamId: team!.id, kind: "team", name: team!.name, minTier })
      .returning();
    return { team: team!, thread: thread! };
  }

  /** The thread is always min_tier 0, so a hidden event proves the event check
   * runs, not just the thread's own copy of the tier. */
  async function eventThread(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        id: newId(),
        title: `${PREFIX}event`,
        startsAt: new Date(Date.now() + DAY),
        ...overrides,
      })
      .returning();
    const [thread] = await db
      .insert(channels)
      .values({ id: newId(), eventId: event!.id, kind: "event", name: event!.title })
      .returning();
    return { event: event!, thread: thread! };
  }

  async function group(slug: string, memberIds: string[], createdBy: string | null = null) {
    const [thread] = await db
      .insert(channels)
      .values({ id: newId(), kind: "group", name: `${PREFIX}${slug}`, createdBy })
      .returning();
    await db
      .insert(chanMembers)
      .values(memberIds.map((userId) => ({ channelId: thread!.id, userId })));
    return thread!;
  }

  async function task(values: Partial<typeof tasks.$inferInsert> = {}) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), title: `${PREFIX}task`, ...values })
      .returning();
    return row!;
  }

  /** Writes a task's ownership, which lives in the junction since R3. */
  async function assignTo(taskId: string, userIds: readonly string[]) {
    await db.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })));
  }

  function ids(rows: { id: string }[]): string[] {
    return rows.map((row) => row.id);
  }

  async function cleanup() {
    // Deletions are audited against the test members; their rows go first.
    await db.execute(sql`
      DELETE FROM "audit_log" WHERE "action" IN ('message.deleted', 'group.deleted')
        AND "actor_id" IN (SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`})
    `);
    // Conversations have no team or event to cascade from, so they are found
    // through their test members — before those members are deleted.
    await db.execute(sql`
      DELETE FROM "channel" WHERE "id" IN (
        SELECT "channel_id" FROM "chan_member"
        WHERE "user_id" IN (SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`})
      ) OR "name" LIKE ${`${PREFIX}%`}
    `);
    // Deleting an event or a team cascades to its thread, and the thread to its
    // messages. Notifications go with their recipients.
    await db.execute(sql`DELETE FROM "event" WHERE "title" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "task" WHERE "title" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "team" WHERE "name" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM auth."user" WHERE "id" LIKE ${`${PREFIX}%`}`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await closeNodeDb();
  });

  describe("POST /api/threads", () => {
    it("starts one dm per pair, whichever side asks", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      signIn(officer);

      const started = await request(app)
        .post("/api/threads")
        .send({ kind: "dm", memberId: director.id });
      expect(started.status).toBe(201);
      expect(started.body.thread).toMatchObject({ kind: "dm", name: null, unreadCount: 0 });
      expect(started.body.thread.memberIds.sort()).toEqual([officer.id, director.id].sort());

      const again = await request(app)
        .post("/api/threads")
        .send({ kind: "dm", memberId: director.id });
      signIn(director);
      const reverse = await request(app)
        .post("/api/threads")
        .send({ kind: "dm", memberId: officer.id });

      expect([again.status, reverse.status]).toEqual([200, 200]);
      expect([again.body.thread.id, reverse.body.thread.id]).toEqual([
        started.body.thread.id,
        started.body.thread.id,
      ]);
    });

    it("starts a group that always includes its creator", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      signIn(officer);

      const response = await request(app)
        .post("/api/threads")
        .send({ kind: "group", name: `${PREFIX}logistics`, memberIds: [director.id, officer.id] });

      expect(response.status).toBe(201);
      expect(response.body.thread.memberIds.sort()).toEqual([officer.id, director.id].sort());
    });

    it("refuses a dm with yourself, an unknown member, and a team thread", async () => {
      const officer = await member("officer", "officer");
      signIn(officer);

      const self = await request(app)
        .post("/api/threads")
        .send({ kind: "dm", memberId: officer.id });
      const unknown = await request(app)
        .post("/api/threads")
        .send({ kind: "dm", memberId: UNKNOWN_ID });
      const team = await request(app).post("/api/threads").send({ kind: "team", name: "x" });

      expect(self.status).toBe(422);
      expect(self.body.error.fields.memberId).toBeDefined();
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.code).toBe("MEMBER_NOT_FOUND");
      expect(team.status).toBe(422);
    });
  });

  describe("GET /api/threads", () => {
    it("shows team and event threads by tier, and conversations by membership", async () => {
      const officer = await member("officer", "officer");
      const president = await member("president", "president");
      const open = await teamThread("open");
      const exec = await teamThread("exec", 1);
      const visibleEvent = await eventThread();
      const hiddenEvent = await eventThread({ minTier: 1 });
      const cancelled = await eventThread({ status: "cancelled" });
      const mine = await group("mine", [officer.id]);
      const theirs = await group("theirs", [president.id]);
      signIn(officer);

      const response = await request(app).get("/api/threads");
      expect(response.status).toBe(200);
      const listed = ids(response.body.threads);

      expect(listed).toEqual(
        expect.arrayContaining([open.thread.id, visibleEvent.thread.id, mine.id]),
      );
      for (const hidden of [
        exec.thread.id,
        hiddenEvent.thread.id,
        cancelled.thread.id,
        theirs.id,
      ]) {
        expect(listed).not.toContain(hidden);
      }

      const teamsOnly = await request(app).get("/api/threads?kind=team");
      expect(teamsOnly.body.threads.every((t: { kind: string }) => t.kind === "team")).toBe(true);
    });

    it("counts messages after your last read, never your own, and clears on read", async () => {
      const officer = await member("officer", "officer");
      const president = await member("president", "president");
      const { thread } = await teamThread("unread");
      await db.insert(messages).values([
        { id: newId(), channelId: thread.id, author: president.id, body: "one" },
        { id: newId(), channelId: thread.id, author: president.id, body: "two" },
        { id: newId(), channelId: thread.id, author: officer.id, body: "mine" },
      ]);
      signIn(officer);

      const summary = async () =>
        (await request(app).get("/api/threads")).body.threads.find(
          (t: { id: string }) => t.id === thread.id,
        );

      expect(await summary()).toMatchObject({ unreadCount: 2, lastReadAt: null, memberIds: [] });

      const read = await request(app).post(`/api/threads/${thread.id}/read`);
      expect(read.status).toBe(200);
      expect(read.body.thread.unreadCount).toBe(0);
      expect(read.body.thread.lastReadAt).not.toBeNull();

      await db
        .insert(messages)
        .values({ id: newId(), channelId: thread.id, author: president.id, body: "three" });
      expect((await summary()).unreadCount).toBe(1);
    });
  });

  /**
   * A cancelled event is a soft delete: out of the lists, still served by its
   * link. Its thread follows suit — readable from the event's page as a
   * read-only archive, kept out of Messages, closed to new posts — and the rule
   * reads the event's status live, so restoring the event reopens the thread.
   */
  describe("a cancelled event's thread", () => {
    it("can still be read, as an archive", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await eventThread({ status: "cancelled" });
      await db
        .insert(messages)
        .values({ id: newId(), channelId: thread.id, author: officer.id, body: "Venue booked." });
      signIn(officer);

      const response = await request(app).get(`/api/threads/${thread.id}/messages`);

      expect(response.status).toBe(200);
      expect(response.body.messages.map((m: { body: string }) => m.body)).toEqual([
        "Venue booked.",
      ]);
    });

    it("refuses new messages and task comments", async () => {
      const officer = await member("officer", "officer");
      const { event, thread } = await eventThread({ status: "cancelled" });
      const onEvent = await task({ eventId: event.id });
      signIn(officer);

      const posted = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: "Still on?" });
      const commented = await request(app)
        .post(`/api/tasks/${onEvent.id}/comments`)
        .send({ body: "Still needed?" });

      expect(posted.status).toBe(409);
      expect(posted.body.error.code).toBe("THREAD_ARCHIVED");
      expect(commented.status).toBe(409);
      expect(commented.body.error.code).toBe("THREAD_ARCHIVED");
      const stored = await db.select().from(messages).where(eq(messages.channelId, thread.id));
      expect(stored).toEqual([]);
    });

    it("opens again, history and all, when the event is restored", async () => {
      const president = await member("president", "president");
      const { event, thread } = await eventThread({ status: "cancelled" });
      signIn(president);

      const restored = await request(app)
        .patch(`/api/events/${event.id}/status`)
        .send({ status: "planning" });
      const posted = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: "Back on." });
      const listed = await request(app).get("/api/threads");

      expect(restored.status).toBe(200);
      expect(posted.status).toBe(201);
      expect(ids(listed.body.threads)).toContain(thread.id);
    });
  });

  describe("/api/threads/:id/messages", () => {
    it("posts, pages newest first, and searches with LIKE wildcards taken literally", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await teamThread("chat");
      signIn(officer);

      const posted = [];
      for (const body of ["alpha is 50% done", "beta", "gamma"]) {
        const response = await request(app)
          .post(`/api/threads/${thread.id}/messages`)
          .send({ body });
        expect(response.status).toBe(201);
        expect(response.body.message.author).toBe(officer.id);
        posted.push(response.body.message.id as string);
      }
      // Pin the pagination fixture order instead of relying on the database
      // wall clock advancing between sequential HTTP requests. Posting itself
      // is still exercised above; this assertion targets the SQL cursor order.
      for (const [index, id] of posted.entries()) {
        await db
          .update(messages)
          .set({ createdAt: new Date(Date.UTC(2026, 9, 10, 12, index)) })
          .where(eq(messages.id, id));
      }
      const [alpha, beta, gamma] = posted;

      const first = await request(app).get(`/api/threads/${thread.id}/messages?limit=2`);
      expect(ids(first.body.messages)).toEqual([gamma, beta]);
      expect(first.body.nextCursor).toBe(beta);

      const second = await request(app).get(
        `/api/threads/${thread.id}/messages?limit=2&before=${first.body.nextCursor}`,
      );
      expect(ids(second.body.messages)).toEqual([alpha]);
      expect(second.body.nextCursor).toBeNull();

      const search = await request(app).get(`/api/threads/${thread.id}/messages?q=%25`);
      expect(ids(search.body.messages)).toEqual([alpha]);
    });

    it("searches message text case-insensitively, keyword-only", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await teamThread("search");
      signIn(officer);
      for (const body of ["Book the VENUE", "venue deposit paid", "unrelated note"]) {
        expect(
          (await request(app).post(`/api/threads/${thread.id}/messages`).send({ body })).status,
        ).toBe(201);
      }

      const response = await request(app).get(`/api/threads/${thread.id}/messages?q=venue`);

      expect(response.status).toBe(200);
      expect(response.body.messages).toHaveLength(2);
      expect(
        (response.body.messages as { body: string }[]).every((message) =>
          message.body.toLowerCase().includes("venue"),
        ),
      ).toBe(true);
    });

    it("404s a thread above your tier, and 422s a cursor from another thread", async () => {
      const officer = await member("officer", "officer");
      const exec = await teamThread("exec", 1);
      const open = await teamThread("open");
      const [elsewhere] = await db
        .insert(messages)
        .values({ id: newId(), channelId: exec.thread.id, body: "private" })
        .returning();
      signIn(officer);

      const statuses = await Promise.all([
        request(app).get(`/api/threads/${exec.thread.id}/messages`),
        request(app).post(`/api/threads/${exec.thread.id}/messages`).send({ body: "hi" }),
        request(app).post(`/api/threads/${exec.thread.id}/read`),
      ]);
      expect(statuses.map((response) => response.status)).toEqual([404, 404, 404]);
      expect(statuses[0]!.body.error.code).toBe("THREAD_NOT_FOUND");

      const cursor = await request(app).get(
        `/api/threads/${open.thread.id}/messages?before=${elsewhere!.id}`,
      );
      expect(cursor.status).toBe(422);
      expect(cursor.body.error.code).toBe("INVALID_CURSOR");
    });

    it("keeps replies one level deep and inside their thread (rule 11)", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await teamThread("replies");
      const other = await teamThread("other");
      signIn(officer);
      const post = (threadId: string, body: Record<string, unknown>) =>
        request(app).post(`/api/threads/${threadId}/messages`).send(body);

      const root = await post(thread.id, { body: "root" });
      const reply = await post(thread.id, { body: "reply", parentId: root.body.message.id });
      const nested = await post(thread.id, { body: "nested", parentId: reply.body.message.id });
      const crossThread = await post(other.thread.id, {
        body: "x",
        parentId: root.body.message.id,
      });

      expect(reply.status).toBe(201);
      expect(reply.body.message.parentId).toBe(root.body.message.id);
      expect([nested.status, crossThread.status]).toEqual([422, 422]);
      expect(nested.body.error.fields.parentId).toBeDefined();
    });
  });

  describe("@mentions", () => {
    async function mentionsFor(userId: string, messageId: string) {
      return db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.kind, "mention"),
            eq(notifications.entityId, messageId),
          ),
        );
    }

    it("notifies a mentioned member who can see the thread", async () => {
      const officer = await member("officer", "officer");
      const other = await member("other", "officer");
      const { thread } = await teamThread("mention-team");
      signIn(officer);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: `hey ${mentionToken(other.id)}, can you look at this` });

      expect(response.status).toBe(201);
      const rows = await mentionsFor(other.id, response.body.message.id);
      expect(rows).toHaveLength(1);
    });

    it("does not notify a self-mention", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await teamThread("mention-self");
      signIn(officer);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: `note to self ${mentionToken(officer.id)}` });

      expect(response.status).toBe(201);
      expect(await mentionsFor(officer.id, response.body.message.id)).toHaveLength(0);
    });

    it("dedupes a person mentioned twice into one notification", async () => {
      const officer = await member("officer", "officer");
      const other = await member("other", "officer");
      const { thread } = await teamThread("mention-dupe");
      signIn(officer);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: `${mentionToken(other.id)} ping, ${mentionToken(other.id)} pong` });

      expect(response.status).toBe(201);
      expect(await mentionsFor(other.id, response.body.message.id)).toHaveLength(1);
    });

    it("drops a mention of someone above the thread's tier, silently", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      const { thread } = await teamThread("mention-exec", 1);
      signIn(director);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: `${mentionToken(officer.id)} fyi` });

      expect(response.status).toBe(201);
      expect(await mentionsFor(officer.id, response.body.message.id)).toHaveLength(0);
    });

    it.each(["group", "dm"] as const)(
      "rejects outsider mentions atomically in a %s, then accepts only its members",
      async (kind) => {
        const officer = await member("officer", "officer");
        const inGroup = await member("in-group", "officer");
        const outsider = await member("outsider", "officer");
        signIn(officer);
        const thread =
          kind === "group"
            ? await group("mention-group", [officer.id, inGroup.id])
            : (await request(app).post("/api/threads").send({ kind: "dm", memberId: inGroup.id }))
                .body.thread;

        const refused = await request(app)
          .post("/api/threads/" + thread.id + "/messages")
          .send({
            body:
              mentionToken(inGroup.id) +
              " and " +
              mentionToken(outsider.id) +
              " " +
              mentionToken(UNKNOWN_ID),
          });

        expect(refused.status).toBe(422);
        expect(refused.body.error).toMatchObject({
          code: "VALIDATION_ERROR",
          fields: { body: ["Mention only people who belong to this conversation."] },
        });
        expect(
          await db.select().from(messages).where(eq(messages.channelId, thread.id)),
        ).toHaveLength(0);
        for (const user of [inGroup, outsider]) {
          expect(
            await db
              .select()
              .from(notifications)
              .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "mention"))),
          ).toHaveLength(0);
        }

        const accepted = await request(app)
          .post("/api/threads/" + thread.id + "/messages")
          .send({
            body:
              mentionToken(inGroup.id) +
              " twice " +
              mentionToken(inGroup.id) +
              " self " +
              mentionToken(officer.id),
          });
        expect(accepted.status).toBe(201);
        expect(await mentionsFor(inGroup.id, accepted.body.message.id)).toHaveLength(1);
        expect(await mentionsFor(officer.id, accepted.body.message.id)).toHaveLength(0);
        expect(await mentionsFor(outsider.id, accepted.body.message.id)).toHaveLength(0);
      },
    );

    it("ignores a malformed token without failing the post", async () => {
      const officer = await member("officer", "officer");
      const { thread } = await teamThread("mention-garbage");
      signIn(officer);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: "cc @[not-a-uuid] and @nobody" });

      expect(response.status).toBe(201);
    });

    it("notifies a mention inside a task comment, using the task's own thread", async () => {
      const officer = await member("officer", "officer");
      const other = await member("other", "officer");
      const { team } = await teamThread("mention-task");
      const work = await task({ teamId: team.id });
      signIn(officer);

      const response = await request(app)
        .post(`/api/tasks/${work.id}/comments`)
        .send({ body: `${mentionToken(other.id)} take a look` });

      expect(response.status).toBe(201);
      expect(await mentionsFor(other.id, response.body.message.id)).toHaveLength(1);
    });
  });

  describe("POST /api/tasks/:id/comments and /attachments", () => {
    it("lands a comment in the event's thread and notifies the task's people", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      const secretary = await member("secretary", "secretary");
      const president = await member("president", "president");
      const { event, thread } = await eventThread();
      const onEvent = await task({ eventId: event.id, creator: president.id });
      await assignTo(onEvent.id, [director.id, secretary.id]);
      signIn(officer);

      const response = await request(app)
        .post(`/api/tasks/${onEvent.id}/comments`)
        .send({ body: "Venue is confirmed." });

      expect(response.status).toBe(201);
      expect(response.body.message).toMatchObject({
        channelId: thread.id,
        taskId: onEvent.id,
        author: officer.id,
      });
      // Both holders are told, not just the first: a comment concerns them all.
      const sent = await db
        .select({ userId: notifications.userId, kind: notifications.kind })
        .from(notifications)
        .where(eq(notifications.entityId, onEvent.id));
      expect(sent.map((row) => row.userId).sort()).toEqual(
        [director.id, secretary.id, president.id].sort(),
      );
      expect(sent.every((row) => row.kind === "task_commented")).toBe(true);
    });

    it("tells a co-assignee who comments once, not once per link", async () => {
      const officer = await member("officer", "officer");
      const director = await member("director", "director");
      const { event } = await eventThread();
      // The author is also an assignee and the creator, so all three
      // deduplication paths overlap in one row.
      const onEvent = await task({ eventId: event.id, creator: officer.id });
      await assignTo(onEvent.id, [officer.id, director.id]);
      signIn(officer);

      const response = await request(app)
        .post(`/api/tasks/${onEvent.id}/comments`)
        .send({ body: "Took a look." });

      expect(response.status).toBe(201);
      const sent = await db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(eq(notifications.entityId, onEvent.id));
      expect(sent.map((row) => row.userId)).toEqual([director.id]);
    });

    it("uses the team's thread for standing work, and 409s a task with neither", async () => {
      const officer = await member("officer", "officer");
      const { team, thread } = await teamThread("standing");
      const teamTask = await task({ teamId: team.id });
      const loose = await task();
      signIn(officer);

      const onTeam = await request(app)
        .post(`/api/tasks/${teamTask.id}/comments`)
        .send({ body: "hi" });
      const nowhere = await request(app)
        .post(`/api/tasks/${loose.id}/comments`)
        .send({ body: "hi" });
      const unknown = await request(app)
        .post(`/api/tasks/${UNKNOWN_ID}/comments`)
        .send({ body: "hi" });

      expect(onTeam.status).toBe(201);
      expect(onTeam.body.message.channelId).toBe(thread.id);
      expect(nowhere.status).toBe(409);
      expect(nowhere.body.error.code).toBe("NO_THREAD");
      expect(unknown.status).toBe(404);
    });

    it("hides a task whose thread is above your tier", async () => {
      const officer = await member("officer", "officer");
      const { event } = await eventThread({ minTier: 1 });
      const hidden = await task({ eventId: event.id, minTier: 1 });
      signIn(officer);

      const response = await request(app)
        .post(`/api/tasks/${hidden.id}/comments`)
        .send({ body: "hi" });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TASK_NOT_FOUND");
    });

    it("records a file on the task, and rejects a malformed one", async () => {
      const officer = await member("officer", "officer");
      const { team } = await teamThread("files");
      const teamTask = await task({ teamId: team.id });
      signIn(officer);
      const file = {
        fileKey: `tasks/${teamTask.id}/run-sheet.pdf`,
        fileName: "run-sheet.pdf",
        fileSizeBytes: 2048,
        fileMime: "application/pdf",
      };

      const attached = await request(app).post(`/api/tasks/${teamTask.id}/attachments`).send(file);
      const malformed = await request(app)
        .post(`/api/tasks/${teamTask.id}/attachments`)
        .send({ ...file, fileMime: "pdf" });

      expect(attached.status).toBe(201);
      expect(attached.body.message).toMatchObject({ ...file, body: "", taskId: teamTask.id });
      expect(malformed.status).toBe(422);
    });
  });

  /**
   * An assistant chat is a channel too, and its owner is its member — which is
   * exactly what the thread routes used to look for. They must not serve it:
   * AI chats live in AI Breakdown only, never in Messages.
   */
  describe("assistant chats", () => {
    async function aiChat(owner: { id: string }) {
      const id = newId();
      await db.insert(channels).values({ id, kind: "ai", name: `${PREFIX}ai-chat` });
      await db.insert(chanMembers).values({ channelId: id, userId: owner.id });
      await db
        .insert(messages)
        .values({ id: newId(), channelId: id, author: owner.id, body: "hi" });
      return id;
    }

    it("never lists an ai chat, even to its owner", async () => {
      const owner = await member("chat-owner", "officer");
      const chatId = await aiChat(owner);
      signIn(owner);

      const response = await request(app).get("/api/threads");

      expect(response.status).toBe(200);
      expect(response.body.threads.map((thread: { id: string }) => thread.id)).not.toContain(
        chatId,
      );
    });

    it("404s reading, posting to and marking an ai chat read, and writes nothing", async () => {
      const owner = await member("chat-poster", "officer");
      const chatId = await aiChat(owner);
      signIn(owner);

      const statuses = await Promise.all([
        request(app).get(`/api/threads/${chatId}/messages`),
        request(app).post(`/api/threads/${chatId}/messages`).send({ body: "from Messages" }),
        request(app).post(`/api/threads/${chatId}/read`),
      ]);

      expect(statuses.map((response) => response.status)).toEqual([404, 404, 404]);
      expect(statuses[0]!.body.error.code).toBe("THREAD_NOT_FOUND");
      const stored = await db.select().from(messages).where(eq(messages.channelId, chatId));
      expect(stored.map((message) => message.body)).toEqual(["hi"]);
    });
  });

  /**
   * Deleting: one message for everyone, which leaves a tombstone, or a whole
   * custom group, which is a soft delete. A message goes by its author or the
   * president, in a thread they can see and write to; a group by the
   * president, or a director who opened it, and only one they are in.
   */
  describe("deletion", () => {
    const audits = (entityId: string) =>
      db.select().from(auditLog).where(eq(auditLog.entityId, entityId));

    async function say(
      threadId: string,
      author: { id: string } | null,
      body: string,
      extra: Partial<typeof messages.$inferInsert> = {},
    ) {
      const [row] = await db
        .insert(messages)
        .values({ id: newId(), channelId: threadId, author: author?.id ?? null, body, ...extra })
        .returning();
      return row!;
    }

    async function notify(userId: string, entityType: string, entityId: string) {
      await db.insert(notifications).values({
        id: newId(),
        userId,
        kind: "mention",
        body: "You were mentioned in a message.",
        entityType,
        entityId,
      });
    }

    const notificationsOf = (userId: string) =>
      db
        .select({ entityType: notifications.entityType, entityId: notifications.entityId })
        .from(notifications)
        .where(eq(notifications.userId, userId));

    /** Resolves once some query in the database is waiting on a row lock. */
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

    describe("DELETE /api/threads/:id/messages/:messageId", () => {
      const remove = (threadId: string, messageId: string) =>
        request(app).delete(`/api/threads/${threadId}/messages/${messageId}`);

      it("lets the author delete their own, leaving a tombstone with no words or file", async () => {
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("own");
        const said = await say(thread.id, officer, "see the attached plan", {
          fileKey: "threads/plan.pdf",
          fileName: "plan.pdf",
          fileSizeBytes: 10,
          fileMime: "application/pdf",
        });
        signIn(officer);

        const response = await remove(thread.id, said.id);

        expect(response.status).toBe(200);
        expect(response.body.message).toMatchObject({
          id: said.id,
          channelId: thread.id,
          author: officer.id,
          body: "",
          fileKey: null,
          fileName: null,
          fileSizeBytes: null,
          fileMime: null,
          deletedBy: officer.id,
          createdAt: said.createdAt.toISOString(),
        });
        expect(response.body.message.deletedAt).not.toBeNull();
        const [stored] = await db.select().from(messages).where(eq(messages.id, said.id));
        expect(stored).toMatchObject({ body: "", fileKey: null, deletedBy: officer.id });

        const [audit] = await audits(said.id);
        expect(audit).toMatchObject({
          actorId: officer.id,
          action: "message.deleted",
          entityType: "message",
          changes: { channelId: thread.id, authority: "author" },
        });
        // What happened, never what it said.
        expect(JSON.stringify(audit!.changes)).not.toContain("plan");
      });

      it("lets the president delete anyone's as a moderator, and no other office", async () => {
        const president = await member("president", "president");
        const vp = await member("vp", "vice_president");
        const director = await member("director", "director");
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("moderated");
        const said = await say(thread.id, officer, "off topic");

        for (const actor of [vp, director]) {
          signIn(actor);
          const refused = await remove(thread.id, said.id);
          expect(refused.status).toBe(403);
          expect(refused.body.error.code).toBe("FORBIDDEN");
        }
        const [kept] = await db.select().from(messages).where(eq(messages.id, said.id));
        expect(kept!.body).toBe("off topic");

        signIn(president);
        const moderated = await remove(thread.id, said.id);
        expect(moderated.status).toBe(200);
        expect(moderated.body.message.deletedBy).toBe(president.id);
        expect((await audits(said.id))[0]!.changes).toMatchObject({ authority: "moderator" });
      });

      it("lets the president moderate a former member's message", async () => {
        const president = await member("president", "president");
        const { thread } = await teamThread("former");
        const said = await say(thread.id, null, "left behind");
        signIn(president);

        const response = await remove(thread.id, said.id);

        expect(response.status).toBe(200);
        expect(response.body.message.author).toBeNull();
      });

      it("answers a repeat with the same tombstone and no second audit row", async () => {
        const officer = await member("officer", "officer");
        const bystander = await member("bystander", "officer");
        const { thread } = await teamThread("repeat");
        const said = await say(thread.id, officer, "twice");
        signIn(officer);

        const first = await remove(thread.id, said.id);
        const second = await remove(thread.id, said.id);
        signIn(bystander);
        const stranger = await remove(thread.id, said.id);

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(second.body.message).toEqual(first.body.message);
        expect(stranger.status).toBe(403);
        expect(await audits(said.id)).toHaveLength(1);
      });

      it("404s a thread you cannot see before saying anything about the message", async () => {
        const president = await member("president", "president");
        const officer = await member("officer", "officer");
        const exec = await teamThread("exec", 1);
        const privateGroup = await group("private", [officer.id]);
        const aboveTier = await say(exec.thread.id, officer, "mine, but hidden now");
        const inGroup = await say(privateGroup.id, officer, "members only");

        signIn(officer);
        const hidden = await remove(exec.thread.id, aboveTier.id);
        signIn(president);
        const notMember = await remove(privateGroup.id, inGroup.id);

        for (const response of [hidden, notMember]) {
          expect(response.status).toBe(404);
          expect(response.body.error.code).toBe("THREAD_NOT_FOUND");
        }
        const [kept] = await db.select().from(messages).where(eq(messages.id, inGroup.id));
        expect(kept!.deletedAt).toBeNull();
      });

      it("404s a message from another thread, and one that does not exist", async () => {
        const officer = await member("officer", "officer");
        const open = await teamThread("open");
        const other = await teamThread("other");
        const elsewhere = await say(other.thread.id, officer, "over there");
        signIn(officer);

        const crossed = await remove(open.thread.id, elsewhere.id);
        const missing = await remove(open.thread.id, UNKNOWN_ID);

        for (const response of [crossed, missing]) {
          expect(response.status).toBe(404);
          expect(response.body.error.code).toBe("MESSAGE_NOT_FOUND");
        }
        const [kept] = await db.select().from(messages).where(eq(messages.id, elsewhere.id));
        expect(kept!.deletedAt).toBeNull();
      });

      it("keeps a cancelled event's thread read-only, for the president too", async () => {
        const president = await member("president", "president");
        const { thread } = await eventThread({ status: "cancelled" });
        const said = await say(thread.id, president, "archived words");
        signIn(president);

        const response = await remove(thread.id, said.id);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("THREAD_ARCHIVED");
        const [kept] = await db.select().from(messages).where(eq(messages.id, said.id));
        expect(kept!.body).toBe("archived words");
      });

      it("422s ids that are not uuids, and refuses an account with no membership", async () => {
        const officer = await member("officer", "officer");
        signIn(officer);
        const malformed = await remove("not-a-thread", "not-a-message");
        expect(malformed.status).toBe(422);

        const authUserId = `${PREFIX}no-membership`;
        await db.execute(sql`
          INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES (${authUserId}, 'Outsider', ${`${authUserId}@example.com`}, false, now(), now())
        `);
        signIn({ authUserId });
        const { thread } = await teamThread("outsider");
        const said = await say(thread.id, officer, "members only");

        const outsider = await remove(thread.id, said.id);
        expect(outsider.status).toBe(403);
        expect(outsider.body.error.code).toBe("NO_MEMBERSHIP");
      });

      it("rejects a reply that waited for its parent to be deleted", async () => {
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("reply-racing-delete");
        const parent = await say(thread.id, officer, "soon gone");
        signIn(officer);
        let posting: Promise<request.Response> | undefined;
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT 1 FROM "message" WHERE "id" = ${parent.id} FOR UPDATE`);
          posting = request(app)
            .post(`/api/threads/${thread.id}/messages`)
            .send({ body: "too late", parentId: parent.id })
            .then((response) => response);
          await someoneWaitsOnALock();
          await tx
            .update(messages)
            .set({ body: "", deletedAt: new Date(), deletedBy: officer.id })
            .where(eq(messages.id, parent.id));
        });
        const response = await posting!;
        expect(response.status).toBe(422);
        expect(response.body.error.fields.parentId[0]).toMatch(/deleted/i);
        expect(await db.select().from(messages).where(eq(messages.parentId, parent.id))).toEqual(
          [],
        );
      });

      it("keeps replies to a deleted message, takes no new ones, and pages from its tombstone", async () => {
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("tombstone");
        signIn(officer);
        const post = async (body: string, parentId?: string) =>
          request(app)
            .post(`/api/threads/${thread.id}/messages`)
            .send(parentId ? { body, parentId } : { body });

        const root = (await post("root words")).body.message;
        const reply = (await post("a reply", root.id)).body.message;
        const later = (await post("later")).body.message;
        expect((await remove(thread.id, root.id)).status).toBe(200);

        const [kept] = await db.select().from(messages).where(eq(messages.id, reply.id));
        expect(kept!.parentId).toBe(root.id);
        const tooLate = await post("too late", root.id);
        expect(tooLate.status).toBe(422);
        expect(tooLate.body.error.fields.parentId[0]).toMatch(/deleted/i);

        const history = await request(app).get(`/api/threads/${thread.id}/messages`);
        expect(ids(history.body.messages)).toEqual([later.id, reply.id, root.id]);
        expect(history.body.messages[2]).toMatchObject({ body: "" });
        expect(history.body.messages[2].deletedAt).not.toBeNull();

        const anchored = await request(app).get(
          `/api/threads/${thread.id}/messages?before=${root.id}`,
        );
        expect(anchored.status).toBe(200);
        expect(anchored.body.messages).toEqual([]);

        const search = await request(app).get(`/api/threads/${thread.id}/messages?q=root`);
        expect(search.body.messages).toEqual([]);
      });

      it("pages past a deleted anchor among messages with the same timestamp", async () => {
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("same-time");
        const at = new Date("2026-01-01T00:00:00.000Z");
        const rows = [];
        for (const body of ["a", "b", "c"])
          rows.push(await say(thread.id, officer, body, { createdAt: at }));
        // Newest first is created_at, then id, both descending.
        const order = rows
          .map((row) => row.id)
          .sort()
          .reverse();
        signIn(officer);
        expect((await remove(thread.id, order[1]!)).status).toBe(200);

        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page = await request(app).get(
            `/api/threads/${thread.id}/messages?limit=1${cursor ? `&before=${cursor}` : ""}`,
          );
          expect(page.status).toBe(200);
          seen.push(...ids(page.body.messages));
          cursor = page.body.nextCursor;
        } while (cursor);

        expect(seen).toEqual(order);
      });

      it("drops the message from unread and activity, and clears only its own notifications", async () => {
        const officer = await member("officer", "officer");
        const president = await member("president", "president");
        const { thread } = await teamThread("activity");
        const first = await say(thread.id, president, "first", {
          createdAt: new Date(Date.now() - 60_000),
        });
        const second = await say(thread.id, president, `@[${officer.id}] second`);
        await notify(officer.id, "message", second.id);
        // Another entity type that happens to share the id is not this message's.
        await notify(officer.id, "task", second.id);
        await notify(officer.id, "message", first.id);
        signIn(officer);
        const summary = async () =>
          (await request(app).get("/api/threads")).body.threads.find(
            (t: { id: string }) => t.id === thread.id,
          );
        expect(await summary()).toMatchObject({
          unreadCount: 2,
          lastMessageAt: second.createdAt.toISOString(),
        });

        signIn(president);
        expect((await remove(thread.id, second.id)).status).toBe(200);

        signIn(officer);
        expect(await summary()).toMatchObject({
          unreadCount: 1,
          lastMessageAt: first.createdAt.toISOString(),
        });
        expect(await notificationsOf(officer.id)).toEqual(
          expect.arrayContaining([
            { entityType: "task", entityId: second.id },
            { entityType: "message", entityId: first.id },
          ]),
        );
        expect(await notificationsOf(officer.id)).toHaveLength(2);

        signIn(president);
        expect((await remove(thread.id, first.id)).status).toBe(200);
        signIn(officer);
        // Nothing left said: activity falls back to when the thread was opened.
        expect(await summary()).toMatchObject({ unreadCount: 0, lastMessageAt: null });
      });

      it("deletes a task comment in its task's thread, keeping its task link", async () => {
        const officer = await member("officer", "officer");
        const { team, thread } = await teamThread("comments");
        const onTeam = await task({ teamId: team.id });
        signIn(officer);
        const comment = await request(app)
          .post(`/api/tasks/${onTeam.id}/comments`)
          .send({ body: "done?" });

        const response = await remove(thread.id, comment.body.message.id);

        expect(response.status).toBe(200);
        expect(response.body.message).toMatchObject({ taskId: onTeam.id, body: "" });
      });

      it("rolls the tombstone and the cleanup back when the audit write fails", async () => {
        const officer = await member("officer", "officer");
        const { thread } = await teamThread("rollback");
        const said = await say(thread.id, officer, `@[${officer.id}] keep me`);
        await notify(officer.id, "message", said.id);
        signIn(officer);
        await db.execute(sql`
          CREATE OR REPLACE FUNCTION test_threads_refuse_audit() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$
        `);
        await db.execute(
          sql.raw(`
            CREATE TRIGGER test_threads_refuse_audit BEFORE INSERT ON "audit_log"
            FOR EACH ROW WHEN (NEW.entity_id = '${said.id}')
            EXECUTE FUNCTION test_threads_refuse_audit()
          `),
        );
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
          expect((await remove(thread.id, said.id)).status).toBe(500);
        } finally {
          quiet.mockRestore();
          await db.execute(sql`DROP TRIGGER IF EXISTS test_threads_refuse_audit ON "audit_log"`);
          await db.execute(sql`DROP FUNCTION IF EXISTS test_threads_refuse_audit()`);
        }

        const [kept] = await db.select().from(messages).where(eq(messages.id, said.id));
        expect(kept).toMatchObject({ body: `@[${officer.id}] keep me`, deletedAt: null });
        expect(await notificationsOf(officer.id)).toHaveLength(1);
      });
    });

    describe("DELETE /api/threads/:id", () => {
      const removeThread = (threadId: string) => request(app).delete(`/api/threads/${threadId}`);

      it("follows the permission matrix for a group the caller opened and is in", async () => {
        const expected: Record<Role, number> = {
          president: 204,
          vice_president: 204,
          treasurer: 204,
          secretary: 204,
          director: 204,
          officer: 204,
        };
        for (const [role, status] of Object.entries(expected) as [Role, number][]) {
          const caller = await member(role, role);
          const opened = await group(`matrix-${role}`, [caller.id], caller.id);
          signIn(caller);

          const response = await removeThread(opened.id);

          expect({ role, status: response.status }).toEqual({ role, status });
          if (status === 403) expect(response.body.error.code).toBe("FORBIDDEN");
        }
      });

      it("lets a director delete only a group they opened", async () => {
        const director = await member("director", "director");
        const other = await member("other", "director");
        const theirs = await group("theirs", [director.id, other.id], other.id);
        const legacy = await group("legacy", [director.id], null);
        signIn(director);

        expect((await removeThread(theirs.id)).status).toBe(403);
        expect((await removeThread(legacy.id)).status).toBe(403);
      });

      it("lets the president delete any group they are in, a legacy one too, and no other", async () => {
        const president = await member("president", "president");
        const officer = await member("officer", "officer");
        const legacy = await group("legacy", [president.id, officer.id], null);
        const outside = await group("outside", [officer.id], officer.id);
        signIn(president);

        expect((await removeThread(legacy.id)).status).toBe(204);
        const hidden = await removeThread(outside.id);
        expect(hidden.status).toBe(404);
        expect(hidden.body.error.code).toBe("THREAD_NOT_FOUND");
        const [kept] = await db.select().from(channels).where(eq(channels.id, outside.id));
        expect(kept!.deletedAt).toBeNull();
      });

      it("keeps a creator's deletion right after demotion to officer", async () => {
        const creator = await member("creator", "director");
        const opened = await group("demoted", [creator.id], creator.id);
        await db.execute(sql`UPDATE "app_user" SET "role" = 'officer' WHERE "id" = ${creator.id}`);
        signIn(creator);

        expect((await removeThread(opened.id)).status).toBe(204);
      });

      it("409s a dm, a team thread and an event thread, and 404s an assistant chat", async () => {
        const president = await member("president", "president");
        const officer = await member("officer", "officer");
        signIn(president);
        const dm = await request(app)
          .post("/api/threads")
          .send({ kind: "dm", memberId: officer.id });
        const team = await teamThread("team");
        const event = await eventThread();
        const chatId = newId();
        await db.insert(channels).values({ id: chatId, kind: "ai", name: `${PREFIX}ai-chat` });
        await db.insert(chanMembers).values({ channelId: chatId, userId: president.id });

        for (const threadId of [dm.body.thread.id, team.thread.id, event.thread.id]) {
          const response = await removeThread(threadId);
          expect(response.status).toBe(409);
          expect(response.body.error.code).toBe("THREAD_DELETE_NOT_ALLOWED");
        }
        expect((await removeThread(chatId)).status).toBe(404);
      });

      it("records who opened a group from the session, never from the body", async () => {
        const officer = await member("officer", "officer");
        const director = await member("director", "director");
        signIn(officer);

        const opened = await request(app)
          .post("/api/threads")
          .send({ kind: "group", name: `${PREFIX}stamped`, createdBy: director.id });
        const dm = await request(app)
          .post("/api/threads")
          .send({ kind: "dm", memberId: director.id });

        expect(opened.body.thread.createdBy).toBe(officer.id);
        expect(dm.body.thread.createdBy).toBeNull();
        expect(opened.body.thread).not.toHaveProperty("deletedAt");
      });

      it("removes the group for every member, from every route", async () => {
        const president = await member("president", "president");
        const officer = await member("officer", "officer");
        signIn(officer);
        const opened = (
          await request(app)
            .post("/api/threads")
            .send({ kind: "group", name: `${PREFIX}closing`, memberIds: [president.id] })
        ).body.thread;
        const said = await request(app)
          .post(`/api/threads/${opened.id}/messages`)
          .send({ body: `@[${president.id}] before it closes` });
        expect(said.status).toBe(201);
        await notify(president.id, "channel", opened.id);
        expect(await notificationsOf(president.id)).toHaveLength(2);

        signIn(president);
        const response = await removeThread(opened.id);
        expect(response.status).toBe(204);
        expect(response.body).toEqual({});

        const [audit] = await audits(opened.id);
        expect(audit).toMatchObject({
          actorId: president.id,
          action: "group.deleted",
          entityType: "channel",
          changes: { authority: "president" },
        });
        expect(await notificationsOf(president.id)).toEqual([]);

        for (const actor of [officer, president]) {
          signIn(actor);
          const listed = await request(app).get("/api/threads");
          expect(ids(listed.body.threads)).not.toContain(opened.id);
          const statuses = await Promise.all([
            request(app).get(`/api/threads/${opened.id}/messages`),
            request(app).post(`/api/threads/${opened.id}/messages`).send({ body: "anyone?" }),
            request(app).post(`/api/threads/${opened.id}/read`),
            removeThread(opened.id),
            request(app).delete(`/api/threads/${opened.id}/messages/${said.body.message.id}`),
          ]);
          expect(statuses.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404]);
        }

        // A soft delete: the history is still there, just never served.
        const [stored] = await db.select().from(channels).where(eq(channels.id, opened.id));
        expect(stored).toMatchObject({ deletedBy: president.id, createdBy: officer.id });
        expect(stored!.deletedAt).not.toBeNull();
        const history = await db.select().from(messages).where(eq(messages.channelId, opened.id));
        expect(history).toHaveLength(1);
      });

      it("makes a post that waited on the deletion find the group gone", async () => {
        const president = await member("president", "president");
        const opened = await group("racing", [president.id], president.id);
        signIn(president);

        let posting: Promise<request.Response> | undefined;
        await db.transaction(async (tx) => {
          // The deletion holds the group's row…
          await tx.execute(sql`SELECT 1 FROM "channel" WHERE "id" = ${opened.id} FOR UPDATE`);
          posting = request(app)
            .post(`/api/threads/${opened.id}/messages`)
            .send({ body: "just in time?" })
            .then((response) => response);
          await someoneWaitsOnALock();
          // …and marks it deleted before committing.
          await tx
            .update(channels)
            .set({ deletedAt: new Date(), deletedBy: president.id })
            .where(eq(channels.id, opened.id));
        });

        const response = await posting!;
        expect(response.status).toBe(404);
        expect(await db.select().from(messages).where(eq(messages.channelId, opened.id))).toEqual(
          [],
        );
      });
    });
  });
});
