import { and, asc, count, eq, gt, sql } from "drizzle-orm";
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

/** The text from `text`'s first `{` to its last `}`, trimmed. Unchanged if neither is found. */
function sliceBraces(text: string): string {
  const body = text.trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * Every JSON candidate worth trying, most-likely-correct first. Models wrap
 * JSON in markdown fences no matter how firmly the prompt says otherwise —
 * and a chatty model may emit MORE THAN ONE fenced block (an illustrative
 * example ahead of the real answer is an ordinary thing for a model to do,
 * even when told not to). Scanning only the first fence would silently
 * return the example instead of the answer.
 *
 * Returns each fenced block's content in order, then the raw body itself as
 * a last-resort candidate for an unfenced reply, deduplicated — a response
 * with a single fence makes both candidates identical.
 */
export function extractJson(raw: string): string[] {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gu;
  for (const match of raw.matchAll(fence)) {
    candidates.push(sliceBraces(match[1] ?? ""));
  }
  candidates.push(sliceBraces(raw));
  return [...new Set(candidates)];
}

/**
 * The one place model output becomes typed data. Two attempts, then fail
 * closed: a 422 the member can act on beats a half-applied guess. Within one
 * attempt, every candidate `extractJson` finds is tried in order — the
 * attempt only counts as failed, falling through to the retry, once NONE of
 * them satisfy the schema. `complete(prompt)` itself still runs at most
 * twice no matter how many candidates a single response yields, and a
 * rejection from `complete` (e.g. `AiQuotaError`) is never caught here — it
 * propagates to the caller immediately rather than being swallowed into an
 * `AiOutputError`.
 */
export async function completeJson<T extends z.ZodTypeAny>(
  complete: CompletionFn,
  prompt: string,
  outputSchema: T,
): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await complete(prompt);
    for (const candidate of extractJson(raw)) {
      try {
        const parsed = outputSchema.safeParse(JSON.parse(candidate));
        if (parsed.success) return parsed.data;
      } catch {
        // JSON.parse threw on this candidate — try the next one.
      }
    }
  }
  throw new AiOutputError();
}

/**
 * `ai_run.channel_id` is NOT NULL, and channel.ts says the assistant "is
 * kind = 'ai', a dedicated PAGE" — so each member gets exactly one, made on
 * first use. Three CHECK constraints apply: the name must be non-blank,
 * min_tier must stay 0, and both parents must be NULL.
 *
 * Two first-use calls for the same member can both read "no channel yet"
 * and both insert, permanently splitting that member's history across two
 * `kind='ai'` channels — channel_one_per_team is kind-scoped, so nothing in
 * the schema stops it. The lock serialises the check-then-insert for this
 * user, same idea as allocateToEvent (routes/events/service.ts) locking the
 * settings row before checking the budget, and the same pattern
 * routes/threads/threads.ts already uses for a dm pair; it is
 * transaction-scoped, so it releases automatically at commit or rollback.
 * ORDER BY keeps the read deterministic even if a duplicate already exists
 * from before this lock did.
 */
export async function resolveAiChannel(tx: Tx, userId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-channel:${userId}`}))`);

  const [existing] = await tx
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
    .where(and(eq(channels.kind, "ai"), eq(chanMembers.userId, userId)))
    .orderBy(asc(channels.createdAt), asc(channels.id))
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
