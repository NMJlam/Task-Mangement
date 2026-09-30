import {
  aiBriefingSchema,
  type AiBriefing,
  type AiProposalStatus,
  type AiRunKind,
} from "@ctp/shared";
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { z } from "zod";
import { CLUB_TIMEZONE } from "../../config/club.js";
import { newId } from "../../db/id.js";
import { aiRuns } from "../../db/schema/index.js";
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
 * The audit row, one per model-backed request. `kind` says what the run was,
 * and `channelId` what it belongs to: a chat run its chat, a summary run the
 * thread it read, a briefing nothing. `cost_micro_usd` is 0 because the Gemini
 * free tier is free — the column stays for the day the club moves to a paid
 * provider.
 */
export async function recordRun(
  tx: Tx,
  args: {
    userId: string;
    kind: AiRunKind;
    channelId: string | null;
    prompt: string;
    steps: RunStep[];
    /** chat: the plan it drafted. briefing: the briefing. */
    result?: unknown;
    proposalStatus?: AiProposalStatus | null;
    /** Set when the caller reports this instant to the client and must read it back unchanged. */
    createdAt?: Date;
  },
): Promise<string> {
  const id = newId();
  await tx.insert(aiRuns).values({
    id,
    kind: args.kind,
    channelId: args.channelId,
    userId: args.userId,
    prompt: args.prompt,
    steps: args.steps,
    result: args.result ?? null,
    proposalStatus: args.proposalStatus ?? null,
    costMicroUsd: 0,
    ...(args.createdAt ? { createdAt: args.createdAt } : {}),
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

export type PromptMessage = { id: string; author: string; body: string; createdAt: Date };

/**
 * Free-tier context windows are small, and one pasted wall of text otherwise
 * blows the request. Budget by CHARACTERS, not message count — oldest dropped
 * first, because the recent end of a thread is what a catch-up needs.
 */
export function budgetMessages(messages: PromptMessage[], maxChars: number): PromptMessage[] {
  const kept: PromptMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const remaining = maxChars - used;
    // Only the newest message is ever cut, and only when it alone overflows the
    // budget: a half-message from further back would read as something said.
    if (message.body.length > remaining && kept.length > 0) break;
    const body = message.body.slice(0, remaining);
    kept.unshift({ ...message, body });
    used += body.length;
  }
  return kept;
}

export function buildSummaryPrompt(messages: PromptMessage[]): string {
  return [
    "Summarise this club discussion thread for a committee member catching up.",
    "Reply with ONE JSON object and nothing else. No markdown, no commentary.",
    "",
    '{"summary": ["3-5 short bullets, most important first"],',
    ' "actionItems": [{"text": "what needs doing", "suggestedAssigneeName": "a name from the thread, or null"}]}',
    "",
    "Only use names that appear as authors below. Invent nothing. If nothing was decided, return an empty actionItems array.",
    "",
    ...messages.map((message) => `${message.author}: ${message.body}`),
  ].join("\n");
}

/**
 * One briefing per member per CLUB day. Computed in CLUB_TIMEZONE rather than
 * UTC for the same reason `daysUntil` is: an evening in Melbourne is already
 * tomorrow in UTC, and the briefing would roll over mid-evening.
 */
export function clubDayKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** What the dashboard already shows the member, as the briefing's only source. */
export type BriefingInput = {
  memberName: string;
  openTasks: { title: string; priority: string; dueAt: string | null }[];
  overdueCount: number;
  weekEvents: { title: string; startsAt: string; openTasks: number; doneTasks: number }[];
  committeeLoad: { name: string; openTaskCount: number }[];
};

/**
 * The briefing restates figures the server computed; it never computes its
 * own. Every name and event it may mention is in the input, and the prompt
 * says so, because a briefing that invents a teammate is worse than none.
 */
export function buildBriefingPrompt(input: BriefingInput): string {
  return [
    `Write ${input.memberName}'s daily briefing for their university club committee.`,
    "Reply with ONE JSON object and nothing else. No markdown, no commentary:",
    '{"summary": "one or two sentences on what matters today", "bullets": ["up to four short points"]}',
    "",
    "Only use names and events that appear below. Invent nothing; if a list is empty, say so plainly.",
    "",
    `THEIR OPEN TASKS: ${JSON.stringify(input.openTasks)}`,
    `THEIR OVERDUE TASKS: ${input.overdueCount}`,
    `EVENTS IN THE NEXT 7 DAYS: ${JSON.stringify(input.weekEvents)}`,
    `COMMITTEE LOAD (open tasks each): ${JSON.stringify(input.committeeLoad)}`,
  ].join("\n");
}

/** What a briefing run is recorded as asking — a label for the audit trail, not a discriminator. */
export const BRIEFING_RUN_PROMPT = "Daily briefing";

/** The briefing as a member reads it in a chat: the summary, then one line per bullet. */
export function briefingText(briefing: AiBriefing): string {
  return [briefing.summary, ...briefing.bullets.map((bullet) => `- ${bullet}`)].join("\n");
}

/**
 * Today's briefing, if one was already generated: the newest briefing run of
 * the caller's on the club's calendar day. It lives on the run itself (spec
 * M4), so it needs no chat and a second visit is not a model call.
 */
export async function findTodaysBriefing(
  db: Queryable,
  userId: string,
  dayKey: string,
): Promise<{ briefing: AiBriefing; generatedAt: Date; runId: string } | undefined> {
  const result = await db.execute<{ id: string; result: unknown; createdAt: Date }>(sql`
    SELECT r."id", r."result", r."created_at" AS "createdAt"
    FROM "ai_run" r
    WHERE r."user_id" = ${userId}
      AND r."kind" = 'briefing'
      AND r."result" IS NOT NULL
      AND to_char(r."created_at" AT TIME ZONE ${CLUB_TIMEZONE}, 'YYYY-MM-DD') = ${dayKey}
    ORDER BY r."created_at" DESC
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return undefined;
  const parsed = aiBriefingSchema.safeParse(row.result);
  return parsed.success
    ? { briefing: parsed.data, generatedAt: new Date(row.createdAt), runId: row.id }
    : undefined;
}

/** How much of a chat the model is shown each turn (spec §4.2). */
export const CHAT_HISTORY_MESSAGES = 40;
export const CHAT_HISTORY_CHAR_BUDGET = 6000;

/**
 * What a chat remembers (spec M2, M3): the words of its recent messages and
 * nothing else. No tool results and no handles cross from one turn to the
 * next — the model re-reads through its tools, under today's permissions, so
 * memory can never hand it an identifier it was not shown this turn.
 */
export function conversationBlock(history: PromptMessage[], maxChars: number): string {
  const kept = budgetMessages(history, maxChars);
  if (kept.length === 0) return "";
  return [
    "CONVERSATION SO FAR:",
    ...kept.map((message) => `${message.author}: ${message.body}`),
  ].join("\n");
}
