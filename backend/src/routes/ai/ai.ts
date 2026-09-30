import {
  aiApplyRequestSchema,
  aiApplyResponseSchema,
  aiMessageRequestSchema,
  aiMessageResponseSchema,
  aiProposalSchema,
  type AiApplyRequest,
  type AiMessageRequest,
  type AiProposal,
  type Tier,
} from "@ctp/shared";
import { and, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";
import { aiConfig } from "../../config/ai.js";
import { CLUB_TIMEZONE } from "../../config/club.js";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { events, messages } from "../../db/schema/index.js";
import { AiDisabledError, AiQuotaError, geminiComplete } from "../../lib/ai/client.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { ValidationError, visibleEvents, type Queryable } from "../events/service.js";
import { ChannelForbiddenError } from "../threads/service.js";
import { applyProposal, ApplyError } from "./apply.js";
import { HandleMap } from "./handles.js";
import { buildSystemPrompt } from "./prompt.js";
import { resolveProposal } from "./resolve.js";
import {
  AiOutputError,
  assertUnderDailyCap,
  completeJson,
  recordRun,
  resolveAiChannel,
  type RunStep,
} from "./service.js";
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
  if (!seed?.eventId) return "";
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
  } else if (error instanceof AiQuotaError) {
    res.status(429).json({ error: { code: "AI_QUOTA_EXCEEDED", message: error.message } });
  } else if (error instanceof AiOutputError) {
    res.status(422).json({ error: { code: "AI_OUTPUT_INVALID", message: error.message } });
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

      const proposal = await resolveProposal(
        db,
        ctx.handles,
        aiProposalSchema.parse(staged),
        CLUB_TIMEZONE,
      );

      const runId = await db.transaction(async (tx) => {
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
        return id;
      });

      res.status(200).json(aiMessageResponseSchema.parse({ runId, reply: replyText, proposal }));
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
