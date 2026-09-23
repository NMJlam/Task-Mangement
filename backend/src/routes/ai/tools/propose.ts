import {
  AI_MAX_PROPOSALS,
  aiEventDiffSchema,
  aiProposedEventSchema,
  aiProposedTaskSchema,
  aiTaskDiffSchema,
} from "@ctp/shared";
import type { Tool, ToolContext } from "./registry.js";

/**
 * Staging, not writing. The tool's whole effect is to put rows on the card the
 * member is about to read; nothing reaches the database until they confirm it.
 * The tier here mirrors POST /api/events, and Task 7 re-checks it at apply
 * time — this one only keeps the assistant from proposing what the member
 * could not then approve.
 */
export const proposeCreateEvent: Tool = {
  name: "proposeCreateEvent",
  minTier: 1,
  describe:
    "Stage ONE new event for the member to review. Give it a ref like $event1 so tasks can be attached to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = aiProposedEventSchema.safeParse(args);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid event" };
    ctx.staged.createEvent = parsed.data;
    return { staged: "event", ref: parsed.data.ref };
  },
};

/**
 * A tier-0 officer may create ONE task by hand, so the assistant may stage one
 * for them and no more. Without this the model would happily draft eight and
 * the member would meet a 403 at the moment they clicked Create — the tier
 * filter exists precisely so that cannot happen (mirrors `POST /api/tasks`
 * tier 0 vs `POST /api/tasks/bulk` tier 1).
 *
 * One task per call, like `proposeCreateEvent` — the model stages several by
 * calling this once per task, and `ctx.staged.createTasks` is the running
 * total the limit is checked against.
 */
export const proposeCreateTasks: Tool = {
  name: "proposeCreateTasks",
  minTier: 0,
  describe:
    "Stage ONE new task for the member to review. Call this once per task. Bind it to an event with eventRef (a $ref staged this same turn) or eventHandle (an existing event), or neither for standing work.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = aiProposedTaskSchema.safeParse(args);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task" };

    const limit = ctx.tier >= 1 ? AI_MAX_PROPOSALS : 1;
    const staged = ctx.staged.createTasks ?? [];
    if (staged.length + 1 > limit) {
      return {
        error: `You may only stage up to ${limit} new task${limit === 1 ? "" : "s"} at your tier.`,
      };
    }

    ctx.staged.createTasks = [...staged, parsed.data];
    return { staged: "task", title: parsed.data.title };
  },
};

/**
 * `PATCH /api/tasks/:id` is tier 0 with no bulk equivalent, so — unlike
 * `proposeCreateTasks` — there is no tier-based sub-limit here, only the
 * combined-proposal cap `aiProposalSchema` itself enforces on `updateTasks`.
 * One diff per call; reassignment is this tool with a diff that touches only
 * `assigneeIds` (the card derives that label itself, §5.2).
 */
export const proposeUpdateTasks: Tool = {
  name: "proposeUpdateTasks",
  minTier: 0,
  describe:
    "Stage ONE field change to an existing task, addressed by handle. Call this once per task — e.g. to reassign several tasks, call it once for each. Provide only the fields that change.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = aiTaskDiffSchema.safeParse(args);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task update" };

    const staged = ctx.staged.updateTasks ?? [];
    if (staged.length + 1 > AI_MAX_PROPOSALS) {
      return { error: `A single turn may stage at most ${AI_MAX_PROPOSALS} proposals.` };
    }

    ctx.staged.updateTasks = [...staged, parsed.data];
    return { staged: "taskUpdate", handle: parsed.data.handle };
  },
};

/**
 * `updateEvent` is singular on `AiProposal` (one event diff per turn, like
 * `createEvent`), so this stages at most one — a second call overwrites the
 * first rather than appending, the same as `proposeCreateEvent`. The status
 * enum it accepts is `aiEventDiffSchema`'s own — `planning | live | wrapped`,
 * exactly what tier 1 may set through `PATCH /api/events/:id/status`.
 * Cancellation has no tool at all (Rule 13); it stays with the president
 * through `DELETE /api/events/:id`.
 */
export const proposeUpdateEvent: Tool = {
  name: "proposeUpdateEvent",
  minTier: 1,
  describe:
    "Stage a change to ONE existing event, addressed by handle. Provide only the fields that change: title, description, venue, startsAt, endsAt, status (planning|live|wrapped).",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = aiEventDiffSchema.safeParse(args);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid event update" };
    ctx.staged.updateEvent = parsed.data;
    return { staged: "eventUpdate", handle: parsed.data.handle };
  },
};

export const PROPOSE_TOOLS: Tool[] = [
  proposeCreateEvent,
  proposeCreateTasks,
  proposeUpdateTasks,
  proposeUpdateEvent,
];
