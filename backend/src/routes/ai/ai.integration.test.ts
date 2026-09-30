import type { Role } from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { CLUB_TIMEZONE } from "../../config/club.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  aiRuns,
  appUsers,
  channels,
  chanMembers,
  events,
  messages,
  taskAssignees,
  tasks,
} from "../../db/schema/index.js";
import { AiUnavailableError } from "../../lib/ai/client.js";
import { dueAtFromOffset } from "./resolve.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

// The provider is the one thing stubbed: everything between the request and
// the model — the loop, the tools, their SQL, the resolution — runs for real.
const complete = vi.hoisted(() => vi.fn<(prompt: string) => Promise<string>>());
vi.mock("../../lib/ai/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai/client.js")>()),
  geminiComplete: complete,
}));

type Step = string | ((prompt: string) => string);

/** Every prompt the model was sent this test, in order. */
let prompts: string[] = [];

/**
 * Plays the model: answers the Nth `complete()` call with the Nth step. A
 * function step reads the prompt it was sent, which is how a later step finds
 * a handle an earlier tool issued — the same way the real model would.
 */
function script(...steps: Step[]) {
  complete.mockImplementation(async (prompt) => {
    prompts.push(prompt);
    const step = steps[prompts.length - 1];
    if (step === undefined) throw new Error(`The script has no step ${prompts.length}`);
    return typeof step === "function" ? step(prompt) : step;
  });
}

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({ tool: { name, args } });
const reply = (text = "Done.") => JSON.stringify({ reply: text });

/** The JSON a tool returned, as the loop showed it to the model in `prompt`. */
function toolResult(prompt: string, name: string): unknown {
  const marker = `TOOL RESULT ${name}: `;
  const line = prompt
    .split("\n")
    .filter((candidate) => candidate.startsWith(marker))
    .at(-1);
  if (!line) throw new Error(`No ${name} result in the prompt`);
  return JSON.parse(line.slice(marker.length));
}

describe("/api/ai", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `test-ai-${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${authUserId}, ${`${authUserId}@example.com`}, true, now(), now())
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
      .values({ id: newId(), title: "test-ai-event", startsAt: new Date(), ...overrides })
      .returning();
    return row!;
  }

  async function seedTask(
    eventId: string | null,
    assigneeIds: readonly string[],
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(tasks)
      .values({ id: newId(), eventId, title: "test-ai-task", ...overrides })
      .returning();
    if (assigneeIds.length > 0) {
      await db
        .insert(taskAssignees)
        .values(assigneeIds.map((userId) => ({ taskId: row!.id, userId })));
    }
    return row!;
  }

  const ours = sql`"title" LIKE 'test-ai-%'`;
  const ourUsers = sql`(SELECT "id" FROM "app_user" WHERE "auth_user_id" LIKE 'test-ai-%')`;

  // ai_run.user_id and the ai channel both hang off app_user, so they go
  // before it; task rows cascade from their events, standing ones do not.
  async function cleanup() {
    await db.execute(sql`DELETE FROM "ai_run" WHERE "user_id" IN ${ourUsers}`);
    await db.execute(sql`
      DELETE FROM "channel" WHERE "kind" = 'ai'
        AND "id" IN (SELECT "channel_id" FROM "chan_member" WHERE "user_id" IN ${ourUsers})
    `);
    await db.execute(sql`DELETE FROM "task" WHERE ${ours}`);
    await db.execute(sql`DELETE FROM "event" WHERE ${ours}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-ai-%'`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE 'test-ai-%'`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    complete.mockReset();
    prompts = [];
    vi.stubEnv("AI_ENABLED", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("AI_DAILY_RUN_CAP", "50");
    await cleanup();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await closeNodeDb();
  });

  describe("POST /api/ai/messages", () => {
    it("503s when the assistant is not enabled, before the model is called", async () => {
      vi.stubEnv("AI_ENABLED", "");
      signedInAs(await member("disabled", "officer"));

      const response = await request(app).post("/api/ai/messages").send({ text: "Hello" });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("AI_DISABLED");
      expect(complete).not.toHaveBeenCalled();
    });

    it("says the AI service is busy, not switched off, when the provider cannot answer", async () => {
      signedInAs(await member("unlucky-timing", "officer"));
      complete.mockRejectedValue(new AiUnavailableError());

      const response = await request(app).post("/api/ai/messages").send({ text: "Hello" });

      expect(response.status).toBe(503);
      expect(response.body.error).toEqual({
        code: "AI_UNAVAILABLE",
        message: "The AI service is busy right now. Try again in a moment.",
      });
    });

    it("answers a question that stages nothing with a reply and no proposal", async () => {
      signedInAs(await member("asker", "officer"));
      script(reply("Nothing is overdue."));

      const response = await request(app)
        .post("/api/ai/messages")
        .send({ text: "Anything overdue?" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ reply: "Nothing is overdue.", proposal: null });
      expect(response.body.runId).toMatch(/^[0-9a-f-]{36}$/u);
    });

    it("keeps the member's message and the stamped reply in their ai channel", async () => {
      const asker = await member("history", "officer");
      signedInAs(asker);
      script(reply("Here you go."));

      const response = await request(app).post("/api/ai/messages").send({ text: "Hi there" });

      const rows = await db
        .select({ author: messages.author, body: messages.body, aiRunId: messages.aiRunId })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
        .where(and(eq(channels.kind, "ai"), eq(chanMembers.userId, asker.id)))
        .orderBy(messages.createdAt);
      expect(rows).toEqual([
        { author: asker.id, body: "Hi there", aiRunId: null },
        { author: null, body: "Here you go.", aiRunId: response.body.runId },
      ]);
    });

    it("feeds a tool's result back to the model before it replies", async () => {
      signedInAs(await member("reader", "officer"));
      await seedEvent({ title: "test-ai-open-day", startsAt: new Date(Date.now() + 86_400_000) });
      script(callTool("listEvents"), reply());

      const response = await request(app).post("/api/ai/messages").send({ text: "What's on?" });

      expect(response.status).toBe(200);
      expect(prompts).toHaveLength(2);
      expect(JSON.stringify(toolResult(prompts[1]!, "listEvents"))).toContain("test-ai-open-day");
    });

    it("resolves a planning proposal to ids, names and absolute due dates", async () => {
      const director = await member("director", "director");
      const helper = await member("helper", "officer");
      signedInAs(director);
      const startsAt = "2026-11-20T08:00:00.000Z";
      script(
        callTool("listMembers"),
        callTool("proposeCreateEvent", { ref: "$event1", title: "test-ai-hack-night", startsAt }),
        (prompt) => {
          const roster = toolResult(prompt, "listMembers") as { handle: string; name: string }[];
          const handle = roster.find((row) => row.name === "test-ai-helper")!.handle;
          return callTool("proposeCreateTasks", {
            tasks: [
              {
                title: "test-ai-book-room",
                dueOffsetDays: -3,
                eventRef: "$event1",
                assigneeHandles: [handle],
              },
            ],
          });
        },
        reply("Here is a plan."),
      );

      const response = await request(app)
        .post("/api/ai/messages")
        .send({ text: "Plan a hack night" });

      expect(response.status).toBe(200);
      expect(response.body.proposal.createEvent).toMatchObject({
        ref: "$event1",
        title: "test-ai-hack-night",
      });
      expect(response.body.proposal.createTasks).toEqual([
        {
          title: "test-ai-book-room",
          priority: "medium",
          dueAt: dueAtFromOffset(new Date(startsAt), -3, CLUB_TIMEZONE).toISOString(),
          assignees: [{ id: helper.id, name: "test-ai-helper" }],
          eventRef: "$event1",
        },
      ]);
      // Handles stop at the server: nothing the client gets still says M1 or E2.
      expect(JSON.stringify(response.body.proposal)).not.toMatch(/"[TEM][0-9]+"/u);
    });

    it("resolves a task change to its id, its title and a before/after diff", async () => {
      signedInAs(await member("editor", "officer"));
      const task = await seedTask(null, [], { title: "test-ai-poster", priority: "medium" });
      script(
        callTool("listTasks"),
        (prompt) => {
          const rows = toolResult(prompt, "listTasks") as { handle: string; title: string }[];
          const handle = rows.find((row) => row.title === "test-ai-poster")!.handle;
          return callTool("proposeUpdateTasks", { diffs: [{ handle, priority: "urgent" }] });
        },
        reply(),
      );

      const response = await request(app)
        .post("/api/ai/messages")
        .send({ text: "Make the poster urgent" });

      expect(response.status).toBe(200);
      expect(response.body.proposal.updateTasks).toEqual([
        {
          id: task.id,
          title: "test-ai-poster",
          diffs: [{ field: "priority", before: "medium", after: "urgent" }],
        },
      ]);
    });

    it("carries a reassignment's new assignee ids, which the card must send back", async () => {
      signedInAs(await member("shuffler", "officer"));
      const newcomer = await member("newcomer", "officer");
      const task = await seedTask(null, [], { title: "test-ai-banner" });
      script(
        callTool("listTasks"),
        callTool("listMembers"),
        (prompt) => {
          const rows = toolResult(prompt, "listTasks") as { handle: string; title: string }[];
          const roster = toolResult(prompt, "listMembers") as { handle: string; name: string }[];
          return callTool("proposeUpdateTasks", {
            diffs: [
              {
                handle: rows.find((row) => row.title === "test-ai-banner")!.handle,
                assigneeHandles: [roster.find((row) => row.name === "test-ai-newcomer")!.handle],
              },
            ],
          });
        },
        reply(),
      );

      const response = await request(app).post("/api/ai/messages").send({ text: "Give it away" });

      expect(response.body.proposal.updateTasks).toEqual([
        {
          id: task.id,
          title: "test-ai-banner",
          diffs: [{ field: "assignees", before: "", after: "test-ai-newcomer" }],
          assigneeIds: [newcomer.id],
        },
      ]);
    });

    it("422s when the model answers in prose twice", async () => {
      signedInAs(await member("prose", "officer"));
      script("Sure! Let me think about that.", "Here is what I found, in words.");

      const response = await request(app).post("/api/ai/messages").send({ text: "Hello" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("AI_OUTPUT_INVALID");
    });

    it("counts a turn that failed toward the daily cap, since it still spent model calls", async () => {
      vi.stubEnv("AI_DAILY_RUN_CAP", "1");
      signedInAs(await member("failing", "officer"));
      script("Sure! Let me think.", "Still thinking, in prose.");

      const first = await request(app).post("/api/ai/messages").send({ text: "One" });
      const second = await request(app).post("/api/ai/messages").send({ text: "Two" });

      expect(first.status).toBe(422);
      expect(second.status).toBe(429);
    });

    it("429s once the member has spent their daily runs", async () => {
      vi.stubEnv("AI_DAILY_RUN_CAP", "1");
      signedInAs(await member("capped", "officer"));
      script(reply(), reply());

      const first = await request(app).post("/api/ai/messages").send({ text: "One" });
      const second = await request(app).post("/api/ai/messages").send({ text: "Two" });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe("AI_QUOTA_EXCEEDED");
      expect(prompts).toHaveLength(1);
    });
  });

  describe("POST /api/ai/proposals/apply", () => {
    /** A real run for the caller to apply against — the card always comes from one. */
    async function runFor(actor: { authUserId: string }): Promise<string> {
      signedInAs(actor);
      script(reply());
      const response = await request(app).post("/api/ai/messages").send({ text: "Plan it" });
      prompts = [];
      return response.body.runId as string;
    }

    const newTask = (title: string, extra: Record<string, unknown> = {}) => ({
      op: "create",
      entity: "task",
      data: { title, priority: "medium", assigneeIds: [], ...extra },
    });
    const stats = { proposed: 8, kept: 7, edited: 1 };

    it("creates a staged event and its tasks, every row stamped with the run", async () => {
      const director = await member("planner", "director");
      const runId = await runFor(director);

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({
          runId,
          stats,
          operations: [
            ...Array.from({ length: 7 }, (_, index) =>
              newTask(`test-ai-step-${index}`, { eventRef: "$event1" }),
            ),
            {
              op: "create",
              entity: "event",
              ref: "$event1",
              data: { title: "test-ai-applied", startsAt: "2026-12-01T09:00:00.000Z" },
            },
          ],
        });

      expect(response.status).toBe(201);
      const [event] = await db.select().from(events).where(eq(events.title, "test-ai-applied"));
      expect(event).toMatchObject({ aiRunId: runId, owner: director.id });
      const created = await db.select().from(tasks).where(eq(tasks.eventId, event!.id));
      expect(created).toHaveLength(7);
      expect(created.every((task) => task.aiRunId === runId)).toBe(true);
      expect(response.body.events).toEqual([{ id: event!.id, title: "test-ai-applied" }]);
      expect(response.body.tasks).toHaveLength(7);
    });

    it("refuses a tier-0 member an event create and writes nothing", async () => {
      const runId = await runFor(await member("hopeful", "officer"));

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({
          runId,
          stats,
          operations: [
            newTask("test-ai-hopeful-task"),
            {
              op: "create",
              entity: "event",
              ref: "$event1",
              data: { title: "test-ai-not-allowed", startsAt: "2026-12-01T09:00:00.000Z" },
            },
          ],
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await db.select().from(events).where(eq(events.title, "test-ai-not-allowed"))).toEqual(
        [],
      );
      expect(await db.select().from(tasks).where(eq(tasks.title, "test-ai-hopeful-task"))).toEqual(
        [],
      );
    });

    it("lets a tier-0 member create one task, as POST /api/tasks does", async () => {
      const officer = await member("single", "officer");
      const runId = await runFor(officer);

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({ runId, stats, operations: [newTask("test-ai-just-one")] });

      expect(response.status).toBe(201);
      const [task] = await db.select().from(tasks).where(eq(tasks.title, "test-ai-just-one"));
      expect(task).toMatchObject({ creator: officer.id, aiRunId: runId });
    });

    it("refuses a tier-0 member two task creates, as POST /api/tasks/bulk does", async () => {
      const runId = await runFor(await member("greedy", "officer"));

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({
          runId,
          stats,
          operations: [newTask("test-ai-first"), newTask("test-ai-second")],
        });

      expect(response.status).toBe(403);
      expect(await db.select().from(tasks).where(eq(tasks.title, "test-ai-first"))).toEqual([]);
    });

    it("rolls the whole batch back when one operation names a task that does not exist", async () => {
      const runId = await runFor(await member("unlucky", "director"));

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({
          runId,
          stats,
          operations: [
            newTask("test-ai-should-vanish"),
            { op: "update", entity: "task", id: newId(), data: { priority: "high" } },
          ],
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TASK_NOT_FOUND");
      expect(await db.select().from(tasks).where(eq(tasks.title, "test-ai-should-vanish"))).toEqual(
        [],
      );
    });

    it("records how much of the card the member kept on the run", async () => {
      const runId = await runFor(await member("scorer", "officer"));

      await request(app)
        .post("/api/ai/proposals/apply")
        .send({ runId, stats, operations: [newTask("test-ai-kept")] });

      const [run] = await db.select().from(aiRuns).where(eq(aiRuns.id, runId));
      expect(run).toMatchObject({ proposedCount: 8, keptCount: 7, editedCount: 1 });
    });

    it("404s a run that belongs to someone else, so nobody scores another's card", async () => {
      const runId = await runFor(await member("author", "officer"));
      signedInAs(await member("stranger", "director"));

      const response = await request(app)
        .post("/api/ai/proposals/apply")
        .send({ runId, stats, operations: [newTask("test-ai-borrowed")] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("RUN_NOT_FOUND");
    });
  });

  describe("GET /api/ai/briefing", () => {
    const briefingJson = JSON.stringify({
      summary: "One task is due before Hack Night.",
      bullets: ["Book the room"],
    });

    /** Every message in `userId`'s ai channel. */
    async function aiMessages(userId: string) {
      return db
        .select({ body: messages.body, aiRunId: messages.aiRunId })
        .from(messages)
        .innerJoin(chanMembers, eq(chanMembers.channelId, messages.channelId))
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(and(eq(channels.kind, "ai"), eq(chanMembers.userId, userId)));
    }

    it("generates today's briefing from the member's own work and stores it once", async () => {
      const reader = await member("morning", "officer");
      signedInAs(reader);
      await seedTask(null, [reader.id], { title: "test-ai-book-room" });
      script(briefingJson);

      const response = await request(app).get("/api/ai/briefing");

      expect(response.status).toBe(200);
      expect(response.body.briefing).toEqual(JSON.parse(briefingJson));
      expect(prompts[0]).toContain("test-ai-book-room");
      const runs = await db
        .select({ kind: aiRuns.kind, channelId: aiRuns.channelId, result: aiRuns.result })
        .from(aiRuns)
        .where(eq(aiRuns.userId, reader.id));
      expect(runs).toEqual([
        { kind: "briefing", channelId: null, result: JSON.parse(briefingJson) },
      ]);
      // A briefing is not a chat: it makes no channel and no message.
      expect(await aiMessages(reader.id)).toEqual([]);
    });

    it("returns the same briefing again that club day without calling the model", async () => {
      signedInAs(await member("again", "officer"));
      script(briefingJson);

      const first = await request(app).get("/api/ai/briefing");
      const second = await request(app).get("/api/ai/briefing");

      expect(second.status).toBe(200);
      expect(second.body.generatedAt).toBe(first.body.generatedAt);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("503s when the assistant is not enabled", async () => {
      vi.stubEnv("AI_ENABLED", "");
      signedInAs(await member("dark", "officer"));

      const response = await request(app).get("/api/ai/briefing");

      expect(response.status).toBe(503);
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/ai/threads/:id/summary", () => {
    const summaryJson = JSON.stringify({
      summary: ["The room is booked.", "Pizza is still open."],
      actionItems: [{ text: "Order pizza", suggestedAssigneeName: "test-ai-talker" }],
    });

    /** An event thread at `minTier`, with `bodies` said in order by one member. */
    async function thread(minTier: 0 | 1 | 2, bodies: readonly string[]) {
      const talker = await member(`talker-${minTier}-${bodies.length}`, "officer");
      const event = await seedEvent({ title: `test-ai-thread-${minTier}`, minTier });
      const [channel] = await db
        .insert(channels)
        .values({ id: newId(), kind: "event", eventId: event.id, name: event.title, minTier })
        .returning();
      const ids: string[] = [];
      for (const [index, body] of bodies.entries()) {
        const id = newId();
        await db.insert(messages).values({
          id,
          channelId: channel!.id,
          author: talker.id,
          body,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        });
        ids.push(id);
      }
      return { channelId: channel!.id, ids };
    }

    it("summarises a thread the member can read, as of its newest message", async () => {
      const catcher = await member("catcher", "officer");
      signedInAs(catcher);
      const { channelId, ids } = await thread(0, ["Room booked", "Who does pizza?"]);
      script(summaryJson);

      const response = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        summary: JSON.parse(summaryJson),
        asOfMessageId: ids.at(-1),
      });
      expect(prompts[0]).toContain("Who does pizza?");
      // The run says what it was and which thread it read — not a chat of the member's.
      const runs = await db
        .select({ kind: aiRuns.kind, channelId: aiRuns.channelId })
        .from(aiRuns)
        .where(eq(aiRuns.userId, catcher.id));
      expect(runs).toEqual([{ kind: "summary", channelId }]);
    });

    it("403s a thread the member cannot open, before the model is called", async () => {
      signedInAs(await member("outsider", "officer"));
      const { channelId } = await thread(2, ["Budget talk"]);

      const response = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(response.status).toBe(403);
      expect(complete).not.toHaveBeenCalled();
    });

    it("422s when the model returns junk twice", async () => {
      signedInAs(await member("junked", "officer"));
      const { channelId } = await thread(0, ["Hello"]);
      script("not json", "still not json");

      const response = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("AI_OUTPUT_INVALID");
    });

    it("serves the same thread again from cache without calling the model", async () => {
      signedInAs(await member("repeat", "officer"));
      const { channelId } = await thread(0, ["Once", "Twice"]);
      script(summaryJson);

      const first = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();
      const second = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("409s an empty thread rather than asking the model to invent one", async () => {
      signedInAs(await member("early", "officer"));
      const { channelId } = await thread(0, []);

      const response = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("THREAD_EMPTY");
      expect(complete).not.toHaveBeenCalled();
    });

    it("503s when the assistant is not enabled", async () => {
      vi.stubEnv("AI_ENABLED", "");
      signedInAs(await member("off", "officer"));
      const { channelId } = await thread(0, ["Hi"]);

      const response = await request(app).post(`/api/ai/threads/${channelId}/summary`).send();

      expect(response.status).toBe(503);
    });
  });

  /**
   * The property the whole design rests on: the assistant sees what its
   * caller could see in the app, and nothing else. A tier-2-only event and a
   * cancelled one are seeded with tasks and a thread; a tier-0 member drives
   * every read tool, then a tier-2 member drives the same script — because a
   * test that only proves absence passes just as well against a tool that
   * returns nothing at all.
   */
  describe("visibility", () => {
    async function seedWorld() {
      const busy = await member("busy", "officer");
      const recently = Date.now() - 60_000;
      const longAgo = new Date("2000-01-01T00:00:00Z");
      const visible = await seedEvent({
        title: "test-ai-visible",
        startsAt: new Date(recently - 1_000),
        allocationCents: 100,
      });
      const hidden = await seedEvent({
        title: "test-ai-hidden",
        minTier: 2,
        startsAt: new Date(recently),
        allocationCents: 100,
      });
      const cancelled = await seedEvent({
        title: "test-ai-cancelled",
        status: "cancelled",
        startsAt: new Date(recently - 2_000),
      });
      for (const [event, label] of [
        [visible, "visible"],
        [hidden, "hidden"],
        [cancelled, "cancelled"],
      ] as const) {
        await seedTask(event.id, [busy.id], { title: `test-ai-${label}-task`, dueAt: longAgo });
      }
      const [thread] = await db
        .insert(channels)
        .values({
          id: newId(),
          kind: "event",
          eventId: hidden.id,
          name: "test-ai-hidden",
          minTier: 2,
        })
        .returning();
      await db.insert(messages).values({
        id: newId(),
        channelId: thread!.id,
        author: busy.id,
        body: "test-ai-hidden-message",
      });
      return { busy };
    }

    /** The tools that list, with no handle to aim them — all five, then a reply. */
    async function driveListReads() {
      script(
        callTool("listEvents"),
        callTool("pastEventPlans"),
        callTool("listTasks"),
        callTool("listOverdueTasks"),
        callTool("listMembers"),
        reply(),
      );
      const response = await request(app).post("/api/ai/messages").send({ text: "Tell me all" });
      expect(response.status).toBe(200);
      return prompts.at(-1)!;
    }

    /**
     * The tools addressed by handle, each aimed at the hidden event. The budget
     * page lists every live event's allocation to every member (GET /api/budget
     * is tier 0), so this is how a model comes to hold a hidden event's handle
     * — and why every handle-addressed tool has to re-check.
     */
    async function driveHandleReads() {
      const hidden = (prompt: string) =>
        (
          toolResult(prompt, "readBudget") as {
            allocations: { eventTitle: string; eventHandle: string }[];
          }
        ).allocations.find((row) => row.eventTitle === "test-ai-hidden")!.eventHandle;
      script(
        callTool("readBudget"),
        (prompt) => callTool("getEventProgress", { eventHandle: hidden(prompt) }),
        (prompt) => callTool("readThread", { eventHandle: hidden(prompt) }),
        (prompt) => callTool("listTasks", { eventHandle: hidden(prompt) }),
        reply(),
      );
      const response = await request(app).post("/api/ai/messages").send({ text: "And that one?" });
      expect(response.status).toBe(200);
      return prompts.at(-1)!;
    }

    const shown = (prompt: string, tool: string) => JSON.stringify(toolResult(prompt, tool));
    const openCount = (prompt: string, name: string) =>
      (toolResult(prompt, "listMembers") as { name: string; openTaskCount: number }[]).find(
        (row) => row.name === name,
      )!.openTaskCount;
    const LISTS = ["listEvents", "pastEventPlans", "listTasks", "listOverdueTasks"];

    it("keeps a tier-2 event and a cancelled one out of every list a tier-0 member reads", async () => {
      await seedWorld();
      signedInAs(await member("officer", "officer"));

      const last = await driveListReads();

      for (const tool of LISTS) {
        expect(shown(last, tool)).toContain("test-ai-visible");
        expect(shown(last, tool)).not.toContain("test-ai-hidden");
        expect(shown(last, tool)).not.toContain("test-ai-cancelled");
      }
      expect(openCount(last, "test-ai-busy")).toBe(1);
    });

    it("refuses a tier-0 member every read addressed to the hidden event", async () => {
      await seedWorld();
      signedInAs(await member("prober", "officer"));

      const last = await driveHandleReads();

      expect(toolResult(last, "getEventProgress")).toHaveProperty("error");
      expect(toolResult(last, "readThread")).toHaveProperty("error");
      expect(last).not.toContain("test-ai-hidden-message");
      expect(toolResult(last, "listTasks")).toEqual([]);
    });

    it("shows a tier-2 member the hidden event through the same lists", async () => {
      await seedWorld();
      signedInAs(await member("secretary", "secretary"));

      const last = await driveListReads();

      for (const tool of LISTS) {
        expect(shown(last, tool)).toContain("test-ai-hidden");
        // Cancelled is the soft delete: gone for every tier.
        expect(shown(last, tool)).not.toContain("test-ai-cancelled");
      }
      expect(openCount(last, "test-ai-busy")).toBe(2);
    });

    it("answers a tier-2 member every read addressed to the hidden event", async () => {
      await seedWorld();
      signedInAs(await member("treasurer", "treasurer"));

      const last = await driveHandleReads();

      expect(toolResult(last, "getEventProgress")).not.toHaveProperty("error");
      expect(shown(last, "readThread")).toContain("test-ai-hidden-message");
      expect(shown(last, "listTasks")).toContain("test-ai-hidden-task");
    });
  });
});
