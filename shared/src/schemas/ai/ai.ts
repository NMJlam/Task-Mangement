import { z } from "zod";
import { changeEventStatusSchema, createEventSchema } from "../event/event.js";
import { taskPrioritySchema } from "../task/task.js";

/**
 * One assistant turn stages at most this many proposals. Enforced twice — as a
 * prompt constraint and here — so a card always fits a review a person will
 * actually do. Longer plans are a conversation.
 */
export const AI_MAX_PROPOSALS = 30;

/**
 * A HANDLE names a row that already exists, issued by a read tool earlier in
 * this run (`T` task, `E` event, `M` member). The model emits these instead of
 * UUIDs, so a hallucinated identifier cannot reach a query — the server
 * resolves handles against the run's own map.
 */
export const aiHandleSchema = z
  .string()
  .regex(/^[TEM][1-9][0-9]{0,2}$/u, "Expected a handle like T1, E2 or M3");

/**
 * A REF names a row staged in this same card, which has no id yet — a task can
 * be bound to the event being created alongside it.
 */
export const aiRefSchema = z
  .string()
  .regex(/^\$[a-z][a-z0-9]{0,23}$/u, "Expected a ref like $event1");

const titleSchema = z.string().trim().min(1, "Title is required").max(200);
const descriptionSchema = z.string().trim().max(2000).optional();

/** What the model proposes for a NEW task. Dates are offsets (D14), never absolute. */
export const aiProposedTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: taskPrioritySchema.default("medium"),
  /** Days relative to the event's `startsAt`; negative is before it. */
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
  assigneeHandles: z.array(aiHandleSchema).max(10).default([]),
  /** Exactly one of these, or neither for a standalone task. */
  eventRef: aiRefSchema.optional(),
  eventHandle: aiHandleSchema.optional(),
});
export type AiProposedTask = z.infer<typeof aiProposedTaskSchema>;

/** What the model proposes for a NEW event. `allocationCents` is absent by design (Rule 13). */
export const aiProposedEventSchema = createEventSchema
  .pick({ title: true, description: true, venue: true, startsAt: true, endsAt: true })
  .extend({ ref: aiRefSchema });
export type AiProposedEvent = z.infer<typeof aiProposedEventSchema>;

/** A change to an existing task. At least one field beyond the handle. */
export const aiTaskDiffSchema = z
  .object({
    handle: aiHandleSchema,
    title: titleSchema.optional(),
    description: descriptionSchema,
    priority: taskPrioritySchema.optional(),
    dueAt: z.coerce.date().nullish(),
    assigneeHandles: z.array(aiHandleSchema).max(10).optional(),
  })
  .refine((diff) => Object.keys(diff).length > 1, {
    message: "Provide at least one field to change",
  });
export type AiTaskDiff = z.infer<typeof aiTaskDiffSchema>;

/**
 * A change to an existing event. `status` reuses `changeEventStatusSchema`'s
 * enum, so the values the assistant can propose are exactly the ones tier 1 may
 * set through `PATCH /api/events/:id/status`.
 */
export const aiEventDiffSchema = z
  .object({
    handle: aiHandleSchema,
    title: titleSchema.optional(),
    description: descriptionSchema,
    venue: z.string().trim().max(200).nullish(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullish(),
    status: changeEventStatusSchema.shape.status.optional(),
  })
  .refine((diff) => Object.keys(diff).length > 1, {
    message: "Provide at least one field to change",
  });
export type AiEventDiff = z.infer<typeof aiEventDiffSchema>;

/** Everything one assistant turn may stage. Every field optional; an answer stages nothing. */
export const aiProposalSchema = z
  .object({
    createEvent: aiProposedEventSchema.optional(),
    createTasks: z.array(aiProposedTaskSchema).max(AI_MAX_PROPOSALS).optional(),
    updateTasks: z.array(aiTaskDiffSchema).max(AI_MAX_PROPOSALS).optional(),
    updateEvent: aiEventDiffSchema.optional(),
  })
  .refine(
    (proposal) =>
      (proposal.createEvent ? 1 : 0) +
        (proposal.createTasks?.length ?? 0) +
        (proposal.updateTasks?.length ?? 0) +
        (proposal.updateEvent ? 1 : 0) <=
      AI_MAX_PROPOSALS,
    { message: `A single turn may stage at most ${AI_MAX_PROPOSALS} proposals` },
  );
export type AiProposal = z.infer<typeof aiProposalSchema>;

// ── What the client renders ──────────────────────────────────────────────────

/**
 * Handles are resolved to ids at the response boundary, so they never leave the
 * backend: the model still emits no UUID, and the card works in ids like every
 * other form in the app. A diff row also needs the CURRENT value to render
 * `before → after`, and only the server can supply that.
 */
const resolvedFieldDiffSchema = z.object({
  field: z.string().min(1),
  /** Rendered as immutable text. Null means the field was unset. */
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ResolvedFieldDiff = z.infer<typeof resolvedFieldDiffSchema>;

const resolvedUpdateSchema = z.object({
  id: z.uuid(),
  /** The row's current title, so the card can label the diff. */
  title: z.string().min(1),
  diffs: z.array(resolvedFieldDiffSchema).min(1),
});

/** `dueOffsetDays` has become an absolute `dueAt`, computed server-side in CLUB_TIMEZONE (D14). */
const resolvedCreateTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: taskPrioritySchema,
  dueAt: z.coerce.date().nullable(),
  assignees: z.array(z.object({ id: z.uuid(), name: z.string() })),
  eventRef: aiRefSchema.optional(),
  eventId: z.uuid().optional(),
});

export const aiResolvedProposalSchema = z.object({
  createEvent: aiProposedEventSchema.optional(),
  createTasks: z.array(resolvedCreateTaskSchema).max(AI_MAX_PROPOSALS).optional(),
  updateTasks: z.array(resolvedUpdateSchema).max(AI_MAX_PROPOSALS).optional(),
  updateEvent: resolvedUpdateSchema.optional(),
});
export type AiResolvedProposal = z.infer<typeof aiResolvedProposalSchema>;

// ── POST /api/ai/messages ────────────────────────────────────────────────────

export const aiMessageRequestSchema = z.object({
  text: z.string().trim().min(1, "Say something").max(4000),
  /** Optional starting context from whichever surface opened the chat. */
  seed: z.object({ eventId: z.uuid().optional() }).optional(),
});
export type AiMessageRequest = z.infer<typeof aiMessageRequestSchema>;

export const aiMessageResponseSchema = z.object({
  runId: z.uuid(),
  reply: z.string(),
  /** Resolved, not raw: the client never sees a handle. */
  proposal: aiResolvedProposalSchema.nullable(),
});
export type AiMessageResponse = z.infer<typeof aiMessageResponseSchema>;

// ── POST /api/ai/proposals/apply ─────────────────────────────────────────────

/**
 * The EDITED card. By this point it is an ordinary form submission that happens
 * to carry AI provenance, so it is re-validated here and re-authorised per
 * operation on the server.
 */
const createEventOperationSchema = z.object({
  op: z.literal("create"),
  entity: z.literal("event"),
  ref: aiRefSchema,
  data: createEventSchema.omit({ allocationCents: true, teamId: true }),
});

const createTaskOperationSchema = z.object({
  op: z.literal("create"),
  entity: z.literal("task"),
  data: z.object({
    title: titleSchema,
    description: descriptionSchema,
    priority: taskPrioritySchema.default("medium"),
    dueAt: z.coerce.date().nullish(),
    assigneeIds: z.array(z.uuid()).max(10).default([]),
    eventId: z.uuid().optional(),
    eventRef: aiRefSchema.optional(),
  }),
});

const updateTaskOperationSchema = z.object({
  op: z.literal("update"),
  entity: z.literal("task"),
  id: z.uuid(),
  data: z.object({
    title: titleSchema.optional(),
    description: descriptionSchema,
    priority: taskPrioritySchema.optional(),
    dueAt: z.coerce.date().nullish(),
    assigneeIds: z.array(z.uuid()).max(10).optional(),
  }),
});

const updateEventOperationSchema = z.object({
  op: z.literal("update"),
  entity: z.literal("event"),
  id: z.uuid(),
  data: z.object({
    title: titleSchema.optional(),
    description: descriptionSchema,
    venue: z.string().trim().max(200).nullish(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullish(),
    status: changeEventStatusSchema.shape.status.optional(),
  }),
});

/**
 * Nested, not one flat `z.discriminatedUnion("op", [...])`: zod requires a
 * discriminated union's top-level branches to carry distinct values for that
 * key, and "create"/"update" here each cover two entities. Discriminating on
 * `op` first and `entity` within each branch keeps that invariant — zod
 * reads through a nested discriminated union's own branches to resolve the
 * outer dispatch, so parsing still short-circuits to one candidate schema.
 */
const applyOperationSchema = z.discriminatedUnion("op", [
  z.discriminatedUnion("entity", [createEventOperationSchema, createTaskOperationSchema]),
  z.discriminatedUnion("entity", [updateTaskOperationSchema, updateEventOperationSchema]),
]);
export type AiApplyOperation = z.infer<typeof applyOperationSchema>;

export const aiApplyRequestSchema = z.object({
  runId: z.uuid(),
  operations: z
    .array(applyOperationSchema)
    .min(1, "Nothing was selected")
    .max(AI_MAX_PROPOSALS + 1),
  /** Evaluation data, written to ai_run. The client is where the edit state lives. */
  stats: z.object({
    proposed: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    edited: z.number().int().nonnegative(),
  }),
});
export type AiApplyRequest = z.infer<typeof aiApplyRequestSchema>;

export const aiApplyResponseSchema = z.object({
  events: z.array(z.object({ id: z.uuid(), title: z.string() })),
  tasks: z.array(z.object({ id: z.uuid(), title: z.string() })),
});
export type AiApplyResponse = z.infer<typeof aiApplyResponseSchema>;

// ── GET /api/ai/briefing ─────────────────────────────────────────────────────

export const aiBriefingSchema = z.object({
  summary: z.string().min(1),
  bullets: z.array(z.string().min(1)).max(4),
});
export type AiBriefing = z.infer<typeof aiBriefingSchema>;

export const aiBriefingResponseSchema = z.object({
  briefing: aiBriefingSchema,
  generatedAt: z.iso.datetime(),
});
export type AiBriefingResponse = z.infer<typeof aiBriefingResponseSchema>;

// ── POST /api/ai/threads/:id/summary ─────────────────────────────────────────

export const aiThreadSummarySchema = z.object({
  summary: z.array(z.string().min(1)).min(1).max(5),
  actionItems: z
    .array(
      z.object({
        text: z.string().min(1).max(200),
        suggestedAssigneeName: z.string().max(120).nullable(),
      }),
    )
    .max(10),
});
export type AiThreadSummary = z.infer<typeof aiThreadSummarySchema>;

export const aiThreadSummaryResponseSchema = z.object({
  summary: aiThreadSummarySchema,
  asOfMessageId: z.uuid(),
});
export type AiThreadSummaryResponse = z.infer<typeof aiThreadSummaryResponseSchema>;
