import type { Role } from "@ctp/shared";
import { mentionToken } from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
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

  async function group(slug: string, memberIds: string[]) {
    const [thread] = await db
      .insert(channels)
      .values({ id: newId(), kind: "group", name: `${PREFIX}${slug}` })
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

    it("in a group, notifies a member and drops a non-member", async () => {
      const officer = await member("officer", "officer");
      const inGroup = await member("in-group", "officer");
      const outsider = await member("outsider", "officer");
      const thread = await group("mention-group", [officer.id, inGroup.id]);
      signIn(officer);

      const response = await request(app)
        .post(`/api/threads/${thread.id}/messages`)
        .send({ body: `${mentionToken(inGroup.id)} and ${mentionToken(outsider.id)}` });

      expect(response.status).toBe(201);
      expect(await mentionsFor(inGroup.id, response.body.message.id)).toHaveLength(1);
      expect(await mentionsFor(outsider.id, response.body.message.id)).toHaveLength(0);
    });

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
});
