import {
  AI_MAX_PROPOSALS,
  aiEventDiffSchema,
  aiProposedEventSchema,
  aiProposedTaskSchema,
  aiTaskDiffSchema,
} from "@ctp/shared";
import { z } from "zod";
import type { Tool, ToolContext } from "./registry.js";

/**
 * Batched, not one-per-call. Every tool step is its own `complete()` call
 * (Task 6's loop), so proposing an 8-task plan one task at a time is ~8 extra
 * model round trips the member waits through — against a free-tier rate
 * limit that is the top demo risk, with the plan silently truncated wherever
 * the step budget runs out. `aiProposalSchema.createTasks` is already
 * `z.array(aiProposedTaskSchema).max(AI_MAX_PROPOSALS)`, so the array shape
 * this parses against was always there.
 */
const proposeCreateTasksArgsSchema = z.object({
  tasks: z.array(aiProposedTaskSchema).min(1, "Provide at least one task"),
});

const proposeUpdateTasksArgsSchema = z.object({
  diffs: z.array(aiTaskDiffSchema).min(1, "Provide at least one change"),
});

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
 * for them and no more — mirrors `POST /api/tasks` tier 0 vs
 * `POST /api/tasks/bulk` tier 1. Without this the model would happily draft
 * eight and the member would meet a 403 at the moment they clicked Create.
 * The cap applies to the TOTAL staged this turn (this call's tasks plus
 * whatever is already in `ctx.staged.createTasks`), not per call — a model
 * that calls this tool twice cannot launder its way past the limit.
 */
export const proposeCreateTasks: Tool = {
  name: "proposeCreateTasks",
  minTier: 0,
  describe: `Stage one or more new tasks for the member to review, in a single call. Args: tasks (array; each may bind to a staged event with eventRef, an existing one with eventHandle, or neither for standing work). A tier-0 caller may stage at most 1 task in total this turn; tier 1+ may stage up to ${AI_MAX_PROPOSALS}.`,
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = proposeCreateTasksArgsSchema.safeParse(args);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid tasks" };

    const limit = ctx.tier >= 1 ? AI_MAX_PROPOSALS : 1;
    const staged = ctx.staged.createTasks ?? [];
    const total = staged.length + parsed.data.tasks.length;
    if (total > limit) {
      return {
        error: `You may only stage up to ${limit} new task${limit === 1 ? "" : "s"} at your tier (this call would bring the total to ${total}).`,
      };
    }

    ctx.staged.createTasks = [...staged, ...parsed.data.tasks];
    return {
      staged: "tasks",
      count: parsed.data.tasks.length,
      total: ctx.staged.createTasks.length,
    };
  },
};

/**
 * `PATCH /api/tasks/:id` is tier 0 with no bulk equivalent, so — unlike
 * `proposeCreateTasks` — there is no tier-based sub-limit here, only the
 * combined-proposal cap `aiProposalSchema` itself enforces on `updateTasks`,
 * applied to the TOTAL staged this turn. Batched for the same reason
 * `proposeCreateTasks` is: reassigning eight tasks is one tool call, not
 * eight `complete()` round trips. Reassignment is a diff that touches only
 * `assigneeHandles` (the card derives that label itself, §5.2).
 */
export const proposeUpdateTasks: Tool = {
  name: "proposeUpdateTasks",
  minTier: 0,
  describe: `Stage field changes to one or more existing tasks, in a single call, each addressed by handle. Args: diffs (array; each needs a handle plus at least one field to change). Provide only the fields that change. A single turn may stage at most ${AI_MAX_PROPOSALS} task changes in total.`,
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = proposeUpdateTasksArgsSchema.safeParse(args);
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Invalid task updates" };

    const staged = ctx.staged.updateTasks ?? [];
    const total = staged.length + parsed.data.diffs.length;
    if (total > AI_MAX_PROPOSALS) {
      return {
        error: `A single turn may stage at most ${AI_MAX_PROPOSALS} proposals (this call would bring task updates to ${total}).`,
      };
    }

    ctx.staged.updateTasks = [...staged, ...parsed.data.diffs];
    return {
      staged: "taskUpdates",
      count: parsed.data.diffs.length,
      total: ctx.staged.updateTasks.length,
    };
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
