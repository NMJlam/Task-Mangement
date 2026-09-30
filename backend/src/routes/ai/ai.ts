import {
  aiApplyRequestSchema,
  aiApplyResponseSchema,
  aiBriefingResponseSchema,
  aiBriefingSchema,
  aiThreadSummaryResponseSchema,
  aiThreadSummarySchema,
  aiMessageRequestSchema,
  aiMessageResponseSchema,
  aiProposalSchema,
  type AiApplyRequest,
  type AiResolvedProposal,
  type AiMessageRequest,
  type AiProposal,
  type Tier,
} from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import { aiConfig } from "../../config/ai.js";
import { CLUB_TIMEZONE } from "../../config/club.js";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { events, messages } from "../../db/schema/index.js";
import {
  AiDisabledError,
  AiQuotaError,
  AiUnavailableError,
  geminiComplete,
} from "../../lib/ai/client.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { ValidationError, visibleEvents, type Queryable } from "../events/service.js";
import { assertCanReadChannel, ChannelForbiddenError } from "../threads/service.js";
import { applyProposal, ApplyError } from "./apply.js";
import { HandleMap } from "./handles.js";
import { buildSystemPrompt } from "./prompt.js";
import { resolveProposal } from "./resolve.js";
import {
  AiOutputError,
  assertUnderDailyCap,
  BRIEFING_RUN_PROMPT,
  budgetMessages,
  buildBriefingPrompt,
  clubDayKey,
  findTodaysBriefing,
  type BriefingInput,
  buildSummaryPrompt,
  completeJson,
  recordRun,
  type PromptMessage,
  resolveAiChannel,
  type RunStep,
} from "./service.js";
import { listEvents, listMembers, listOverdueTasks, listTasks } from "./tools/read.js";
import { runTool, toolsFor, type ToolContext } from "./tools/registry.js";

export const aiRouter = Router();

/**
 * A hard stop on the tool loop. A full plan is already six steps — read the past
 * corpus, read the roster, read the event, propose the event, propose the tasks,
 * then reply — so six left no headroom for a single wasted or retried call.
 * Eight absorbs one mis-step while still stopping a looping model from spending
 * the club's shared free-tier quota in one request. Every step is its own
 * `complete()` call, which is also why the propose tools take batches.
 */
const MAX_TOOL_STEPS = 8;

/** What the model may say on each step: call one tool, or finish with a reply. */
const stepSchema = z.union([
  z.object({
    tool: z.object({
      name: z.string().min(1),
      args: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
  z.object({ reply: z.string().trim().min(1) }),
]);

/**
 * A tool the model aims at something it may not see, or at a handle this run
 * never issued, is answered like any other refusal: as the tool's result, so
 * the assistant can say so in its reply. Aborting the whole turn would throw
 * away every read before it for what is usually one wrong guess. Nothing is
 * revealed either way — the refusal is the whole answer.
 */
async function runToolForModel(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await runTool(ctx, name, args);
  } catch (error) {
    if (error instanceof ChannelForbiddenError || error instanceof AiOutputError) {
      return { error: error.message };
    }
    throw error;
  }
}

/** A seeded event becomes a line of context — only if the caller could open it themselves. */
async function seedContext(
  db: Queryable,
  handles: HandleMap,
  tier: Tier,
  seed: AiMessageRequest["seed"],
): Promise<string> {
  if (!seed || !("eventId" in seed)) return "";
  const [event] = await db
    .select({ id: events.id, title: events.title, startsAt: events.startsAt })
    .from(events)
    .where(and(eq(events.id, seed.eventId), visibleEvents(tier)));
  if (!event) return "";
  return `The member is looking at event ${handles.issue("E", event.id)}: "${event.title}", starting ${event.startsAt.toISOString()}.`;
}

function sendAiError(res: Response, error: unknown): boolean {
  if (error instanceof AiDisabledError) {
    res.status(503).json({ error: { code: "AI_DISABLED", message: error.message } });
  } else if (error instanceof AiUnavailableError) {
    // 503 like AI_DISABLED, but a different code: the assistant is on and the
    // provider is momentarily busy, so the client keeps the composer and says so.
    res.status(503).json({ error: { code: "AI_UNAVAILABLE", message: error.message } });
  } else if (error instanceof AiQuotaError) {
    res.status(429).json({ error: { code: "AI_QUOTA_EXCEEDED", message: error.message } });
  } else if (error instanceof AiOutputError) {
    res.status(422).json({ error: { code: "AI_OUTPUT_INVALID", message: error.message } });
  } else if (error instanceof ChannelForbiddenError) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: error.message } });
  } else if (error instanceof ApplyError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error instanceof ValidationError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        fields: error.fields,
      },
    });
  } else {
    return false;
  }
  return true;
}

// ── POST /api/ai/messages ────────────────────────────────────────────────────

aiRouter.post(
  "/ai/messages",
  authenticate,
  authorise(0),
  validate(aiMessageRequestSchema),
  async (req, res, next) => {
    try {
      const receivedAt = new Date();
      const body = res.locals.validated as AiMessageRequest;
      const me = req.user!;
      const config = aiConfig();
      if (!config.enabled) throw new AiDisabledError();

      const db = getDb();
      await assertUnderDailyCap(db, me.id, config.dailyRunCap);

      const staged: AiProposal = {};
      const ctx: ToolContext = {
        db,
        userId: me.id,
        tier: me.tier,
        handles: new HandleMap(),
        staged,
      };
      let transcript = [
        buildSystemPrompt(
          toolsFor(me.tier),
          await seedContext(db, ctx.handles, me.tier, body.seed),
        ),
        "",
        `MEMBER: ${body.text}`,
      ].join("\n");

      const steps: RunStep[] = [];
      let replyText: string | undefined;
      let proposal: AiResolvedProposal | null;
      try {
        for (let step = 0; step < MAX_TOOL_STEPS && replyText === undefined; step += 1) {
          const next = await completeJson(geminiComplete, transcript, stepSchema);
          if ("reply" in next) {
            replyText = next.reply;
            break;
          }
          const started = Date.now();
          const result = await runToolForModel(ctx, next.tool.name, next.tool.args);
          steps.push({ tool: next.tool.name, ms: Date.now() - started });
          transcript += `\nASSISTANT: ${JSON.stringify(next)}\nTOOL RESULT ${next.tool.name}: ${JSON.stringify(result)}`;
        }
        // Out of steps with no answer: fail closed, the same as unusable output.
        if (replyText === undefined) {
          throw new AiOutputError("The assistant took too many steps. Try a narrower question.");
        }
        proposal = await resolveProposal(
          db,
          ctx.handles,
          aiProposalSchema.parse(staged),
          CLUB_TIMEZONE,
        );
      } catch (error) {
        // A failed turn still spent model calls — up to two per step — so it is
        // recorded like any other run, or retrying a prompt the model keeps
        // fumbling would spend the club's quota without the daily cap noticing.
        if (error instanceof AiOutputError) {
          await db.transaction((tx) =>
            recordRun(tx, {
              userId: me.id,
              prompt: body.text,
              steps: [...steps, { tool: "failed", ms: 0 }],
            }),
          );
        }
        throw error;
      }

      const { runId, chatId } = await db.transaction(async (tx) => {
        const id = await recordRun(tx, { userId: me.id, prompt: body.text, steps });
        const channelId = await resolveAiChannel(tx, me.id);
        // Explicit timestamps: both rows share one transaction, and now() is
        // the transaction's start, so the default would tie them.
        await tx.insert(messages).values([
          { id: newId(), channelId, author: me.id, body: body.text, createdAt: receivedAt },
          {
            id: newId(),
            channelId,
            author: null,
            body: replyText,
            aiRunId: id,
            createdAt: new Date(),
          },
        ]);
        return { runId: id, chatId: channelId };
      });

      res
        .status(200)
        .json(aiMessageResponseSchema.parse({ chatId, runId, reply: replyText, proposal }));
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);

// ── POST /api/ai/proposals/apply ─────────────────────────────────────────────

aiRouter.post(
  "/ai/proposals/apply",
  authenticate,
  authorise(0),
  validate(aiApplyRequestSchema),
  async (req, res, next) => {
    try {
      if (!aiConfig().enabled) throw new AiDisabledError();
      const body = res.locals.validated as AiApplyRequest;
      const applied = await getDb().transaction((tx) => applyProposal(tx, req.user!, body));
      res.status(201).json(aiApplyResponseSchema.parse(applied));
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);

// ── POST /api/ai/threads/:id/summary ─────────────────────────────────────────

/** The newest messages a catch-up reads, then trimmed to the character budget below. */
const SUMMARY_MESSAGE_LIMIT = 100;
const SUMMARY_CHAR_BUDGET = 12000;
const SUMMARY_CACHE_LIMIT = 50;

/**
 * A local convenience: reopening a tab during development costs nothing. On
 * Vercel each invocation is a fresh process, so AI_DAILY_RUN_CAP is the quota
 * guard that matters. Keyed on the newest message id, so a summary is never
 * served for a thread that has moved on.
 */
const summaryCache = new Map<string, z.infer<typeof aiThreadSummaryResponseSchema>>();

const threadParamsSchema = z.object({ id: z.uuid() });

class ThreadEmptyError extends Error {}

/** Newest-last, each with its author's display name — the thread as a member reads it. */
async function threadMessages(db: Queryable, channelId: string): Promise<PromptMessage[]> {
  const result = await db.execute<{
    id: string;
    author: string;
    body: string;
    createdAt: Date;
  }>(sql`
    SELECT m."id", COALESCE(u."name", 'Someone') AS "author", m."body", m."created_at" AS "createdAt"
    FROM "message" m
    LEFT JOIN "app_user" au ON au."id" = m."author"
    LEFT JOIN auth."user" u ON u."id" = au."auth_user_id"
    WHERE m."channel_id" = ${channelId} AND m."body" <> ''
    ORDER BY m."created_at" DESC, m."id" DESC
    LIMIT ${SUMMARY_MESSAGE_LIMIT}
  `);
  return result.rows.reverse().map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
}

aiRouter.post(
  "/ai/threads/:id/summary",
  authenticate,
  authorise(0),
  validate(threadParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const config = aiConfig();
      if (!config.enabled) throw new AiDisabledError();
      const me = req.user!;
      const channelId = req.params.id!;
      const db = getDb();

      await assertCanReadChannel(db, { id: me.id, tier: me.tier as Tier }, channelId);
      const thread = await threadMessages(db, channelId);
      const newest = thread.at(-1);
      if (!newest) throw new ThreadEmptyError();

      const key = `${channelId}:${newest.id}`;
      const cached = summaryCache.get(key);
      if (cached) {
        res.status(200).json(cached);
        return;
      }

      await assertUnderDailyCap(db, me.id, config.dailyRunCap);
      const kept = budgetMessages(thread, SUMMARY_CHAR_BUDGET);
      const started = Date.now();
      const summary = await completeJson(
        geminiComplete,
        buildSummaryPrompt(kept),
        aiThreadSummarySchema,
      );
      await db.transaction((tx) =>
        recordRun(tx, {
          userId: me.id,
          prompt: `Summarise thread ${channelId}`,
          steps: [{ tool: "summariseThread", ms: Date.now() - started }],
        }),
      );

      const body = aiThreadSummaryResponseSchema.parse({ summary, asOfMessageId: newest.id });
      summaryCache.set(key, body);
      // A Map iterates in insertion order, so the first key is the oldest entry.
      if (summaryCache.size > SUMMARY_CACHE_LIMIT) {
        summaryCache.delete(summaryCache.keys().next().value!);
      }
      res.status(200).json(body);
    } catch (error) {
      if (error instanceof ThreadEmptyError) {
        res
          .status(409)
          .json({ error: { code: "THREAD_EMPTY", message: "There is nothing to summarise yet." } });
        return;
      }
      if (!sendAiError(res, error)) next(error);
    }
  },
);

// ── GET /api/ai/briefing ─────────────────────────────────────────────────────

type TaskRow = { title: string; status: string; priority: string; dueAt: string | null };
type EventRow = { handle: string; title: string; startsAt: string };
type MemberRow = { handle: string; name: string; openTaskCount: number };

/**
 * The dashboard's figures, read through the assistant's own tools so the
 * briefing sees exactly what the member could see there — and nothing a
 * tier-gated event would add.
 */
async function briefingInput(ctx: ToolContext, now: Date): Promise<BriefingInput> {
  const myHandle = ctx.handles.issue("M", ctx.userId);
  const mine = (await listTasks.run(ctx, { assigneeHandle: myHandle })) as TaskRow[];
  const overdue = (await listOverdueTasks.run(ctx, { assigneeHandle: myHandle })) as TaskRow[];
  const week = (await listEvents.run(ctx, {
    from: now.toISOString(),
    to: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  })) as EventRow[];
  const roster = (await listMembers.run(ctx, {})) as MemberRow[];

  const weekEvents = await Promise.all(
    week.map(async (event) => {
      const eventTasks = (await listTasks.run(ctx, { eventHandle: event.handle })) as TaskRow[];
      const doneTasks = eventTasks.filter((task) => task.status === "done").length;
      return {
        title: event.title,
        startsAt: event.startsAt,
        openTasks: eventTasks.length - doneTasks,
        doneTasks,
      };
    }),
  );

  return {
    memberName: roster.find((row) => row.handle === myHandle)?.name ?? "the member",
    openTasks: mine
      .filter((task) => task.status !== "done")
      .map(({ title, priority, dueAt }) => ({ title, priority, dueAt })),
    overdueCount: overdue.length,
    weekEvents,
    committeeLoad: roster
      .filter((row) => row.openTaskCount > 0)
      .sort((a, b) => b.openTaskCount - a.openTaskCount)
      .slice(0, 10)
      .map(({ name, openTaskCount }) => ({ name, openTaskCount })),
  };
}

aiRouter.get("/ai/briefing", authenticate, authorise(0), async (req, res, next) => {
  try {
    const config = aiConfig();
    if (!config.enabled) throw new AiDisabledError();
    const me = req.user!;
    const db = getDb();
    const now = new Date();

    // One per member per club day (D15): a second visit reads the stored one.
    const today = await findTodaysBriefing(db, me.id, clubDayKey(now, CLUB_TIMEZONE));
    if (today) {
      res.status(200).json(
        aiBriefingResponseSchema.parse({
          briefing: today.briefing,
          generatedAt: today.generatedAt.toISOString(),
        }),
      );
      return;
    }

    await assertUnderDailyCap(db, me.id, config.dailyRunCap);
    const ctx: ToolContext = {
      db,
      userId: me.id,
      tier: me.tier,
      handles: new HandleMap(),
      staged: {},
    };
    const started = Date.now();
    const briefing = await completeJson(
      geminiComplete,
      buildBriefingPrompt(await briefingInput(ctx, now)),
      aiBriefingSchema,
    );

    const generatedAt = new Date();
    await db.transaction(async (tx) => {
      const runId = await recordRun(tx, {
        userId: me.id,
        prompt: BRIEFING_RUN_PROMPT,
        steps: [{ tool: "dailyBriefing", ms: Date.now() - started }],
      });
      const channelId = await resolveAiChannel(tx, me.id);
      await tx.insert(messages).values({
        id: newId(),
        channelId,
        author: null,
        body: JSON.stringify(briefing),
        aiRunId: runId,
        createdAt: generatedAt,
      });
    });

    res
      .status(200)
      .json(aiBriefingResponseSchema.parse({ briefing, generatedAt: generatedAt.toISOString() }));
  } catch (error) {
    if (!sendAiError(res, error)) next(error);
  }
});
