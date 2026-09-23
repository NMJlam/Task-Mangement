import { and, count, eq, gt, sql } from "drizzle-orm";
import type { z } from "zod";
import { newId } from "../../db/id.js";
import { aiRuns, chanMembers, channels } from "../../db/schema/index.js";
import { AiQuotaError, type CompletionFn } from "../../lib/ai/client.js";
// `Tx` and `Queryable` are derived ONCE, in routes/events/service.ts, and
// imported everywhere else — routes/threads/service.ts already does exactly
// this. Re-deriving them here would be a second definition free to drift.
import type { Queryable, Tx } from "../events/service.js";

/** 422 — the model produced something that is not our schema, twice. */
export class AiOutputError extends Error {
  constructor(message = "The assistant returned something unusable. Try rephrasing.") {
    super(message);
    this.name = "AiOutputError";
  }
}

/**
 * Models wrap JSON in markdown fences no matter how firmly the prompt says
 * otherwise, and sometimes prefix it with a sentence. Strip both before parsing
 * rather than burning a retry on a response that was actually correct.
 */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * The one place model output becomes typed data. Two attempts, then fail
 * closed: a 422 the member can act on beats a half-applied guess.
 */
export async function completeJson<T extends z.ZodTypeAny>(
  complete: CompletionFn,
  prompt: string,
  outputSchema: T,
): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await complete(prompt);
    try {
      const parsed = outputSchema.safeParse(JSON.parse(extractJson(raw)));
      if (parsed.success) return parsed.data;
    } catch {
      // JSON.parse threw — fall through to the retry.
    }
  }
  throw new AiOutputError();
}

/**
 * `ai_run.channel_id` is NOT NULL, and channel.ts says the assistant "is
 * kind = 'ai', a dedicated PAGE" — so each member gets exactly one, made on
 * first use. Three CHECK constraints apply: the name must be non-blank,
 * min_tier must stay 0, and both parents must be NULL.
 */
export async function resolveAiChannel(tx: Tx, userId: string): Promise<string> {
  const [existing] = await tx
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
    .where(and(eq(channels.kind, "ai"), eq(chanMembers.userId, userId)))
    .limit(1);
  if (existing) return existing.id;

  const channelId = newId();
  await tx.insert(channels).values({ id: channelId, kind: "ai", name: "Assistant" });
  await tx.insert(chanMembers).values({ channelId, userId });
  return channelId;
}

/**
 * The free tier has one shared quota, so one member running the planner in a
 * loop would spend the club's day. Counted off ai_run — no extra table.
 */
export async function assertUnderDailyCap(
  db: Queryable,
  userId: string,
  cap: number,
): Promise<void> {
  const [row] = await db
    .select({ runs: count() })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), gt(aiRuns.createdAt, sql`now() - interval '24 hours'`)));
  if ((row?.runs ?? 0) >= cap) throw new AiQuotaError();
}

export type RunStep = { tool: string; ms: number; detail?: Record<string, string | number> };

/**
 * The audit row. `cost_micro_usd` is 0 because the Gemini free tier is free —
 * the column stays for the day the club moves to a paid provider.
 */
export async function recordRun(
  tx: Tx,
  args: { userId: string; prompt: string; steps: RunStep[] },
): Promise<string> {
  const channelId = await resolveAiChannel(tx, args.userId);
  const id = newId();
  await tx.insert(aiRuns).values({
    id,
    channelId,
    userId: args.userId,
    prompt: args.prompt,
    steps: args.steps,
    costMicroUsd: 0,
  });
  return id;
}

/** Written when a card is applied (D16). A run that only answered leaves these null. */
export async function recordRunOutcome(
  db: Queryable,
  runId: string,
  stats: { proposed: number; kept: number; edited: number },
): Promise<void> {
  await db
    .update(aiRuns)
    .set({ proposedCount: stats.proposed, keptCount: stats.kept, editedCount: stats.edited })
    .where(eq(aiRuns.id, runId));
}
