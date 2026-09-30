import {
  changeEventStatusSchema,
  createTaskSchema,
  taskPrioritySchema,
  type AiApplyOperation,
  type AiResolvedProposal,
} from "@ctp/shared";

export type ResolvedCreateEvent = NonNullable<AiResolvedProposal["createEvent"]>;
export type ResolvedCreateTask = NonNullable<AiResolvedProposal["createTasks"]>[number];
export type ResolvedUpdate = NonNullable<AiResolvedProposal["updateEvent"]>;

export type SectionKind =
  "create-event" | "create-task" | "update-event" | "update-task" | "reassign-task";

/** One line on the card. `key` is stable across edits, so React keeps each row's state. */
export type CardRow =
  | { key: string; kind: "create-event"; value: ResolvedCreateEvent }
  | { key: string; kind: "create-task"; value: ResolvedCreateTask }
  | { key: string; kind: "update-event" | "update-task" | "reassign-task"; value: ResolvedUpdate };

export type CardSection = { key: string; kind: SectionKind; label: string; rows: CardRow[] };

export const SECTION_LABELS: Record<SectionKind, string> = {
  "create-event": "Create event",
  "create-task": "Create tasks",
  "update-event": "Update event",
  "update-task": "Update tasks",
  "reassign-task": "Reassign tasks",
};

const isReassignment = (update: ResolvedUpdate) =>
  update.diffs.every((diff) => diff.field === "assignees");

/**
 * Section identity is DERIVED from the payload, never declared by the model, so
 * a mislabelled section is impossible (spec §5.2). A task diff whose every
 * changed field is `assignees` is a reassignment; anything else is an update.
 * The create-event section comes first, so a plan reads in the order it will
 * be applied; empty sections are left out.
 */
export function deriveSections(proposal: AiResolvedProposal): CardSection[] {
  const updates = proposal.updateTasks ?? [];
  const candidates: CardSection[] = [
    {
      key: "create-event",
      kind: "create-event",
      label: SECTION_LABELS["create-event"],
      rows: proposal.createEvent
        ? [{ key: "event", kind: "create-event", value: proposal.createEvent }]
        : [],
    },
    {
      key: "create-task",
      kind: "create-task",
      label: SECTION_LABELS["create-task"],
      rows: (proposal.createTasks ?? []).map((value, index) => ({
        key: `task-${index}`,
        kind: "create-task",
        value,
      })),
    },
    {
      key: "update-event",
      kind: "update-event",
      label: SECTION_LABELS["update-event"],
      rows: proposal.updateEvent
        ? [
            {
              key: `update-${proposal.updateEvent.id}`,
              kind: "update-event",
              value: proposal.updateEvent,
            },
          ]
        : [],
    },
    ...(["update-task", "reassign-task"] as const).map((kind) => ({
      key: kind,
      kind,
      label: SECTION_LABELS[kind],
      rows: updates
        .filter((update) => isReassignment(update) === (kind === "reassign-task"))
        .map((value) => ({ key: `update-${value.id}`, kind, value })),
    })),
  ];
  return candidates.filter((section) => section.rows.length > 0);
}

/** Field → first problem, for the fields a row can edit. Empty when the row is valid. */
export type RowErrors = Partial<Record<string, string>>;

/** Diff fields whose `after` the member may retype on the card. */
export const EDITABLE_DIFF_FIELDS = new Set(["title", "description", "venue"]);

export function rowErrors(row: CardRow): RowErrors {
  if (row.kind === "create-task") {
    const { title, description, priority, dueAt, assignees } = row.value;
    const parsed = createTaskSchema.safeParse({
      title,
      description,
      priority,
      dueAt,
      assigneeIds: assignees.map((assignee) => assignee.id),
    });
    if (parsed.success) return {};
    const errors: RowErrors = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "title");
      errors[field] ??= issue.message;
    }
    return errors;
  }
  if (row.kind === "create-event") {
    const { title, startsAt, endsAt } = row.value;
    if (!title.trim()) return { title: "Title is required" };
    if (endsAt && endsAt < startsAt) return { endsAt: "Ends before it starts" };
    return {};
  }
  const title = row.value.diffs.find((diff) => diff.field === "title");
  return title && !title.after?.trim() ? { title: "Title is required" } : {};
}

/** Every diff, as the field-by-field patch its update route takes. */
function patchFrom(update: ResolvedUpdate): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const { field, after } of update.diffs) {
    if (field === "assignees") patch.assigneeIds = update.assigneeIds ?? [];
    else if (field === "priority") patch.priority = taskPrioritySchema.parse(after);
    else if (field === "status") patch.status = changeEventStatusSchema.shape.status.parse(after);
    else if (field === "startsAt") patch.startsAt = new Date(after ?? "");
    else if (field === "dueAt" || field === "endsAt") patch[field] = after ? new Date(after) : null;
    else if (field === "description") patch.description = after ?? "";
    else patch[field] = after;
  }
  return patch;
}

/** The apply operation a checked, valid row stands for. */
export function rowOperation(row: CardRow): AiApplyOperation {
  if (row.kind === "create-event") {
    const { ref, ...data } = row.value;
    return { op: "create", entity: "event", ref, data };
  }
  if (row.kind === "create-task") {
    const { assignees, ...data } = row.value;
    return {
      op: "create",
      entity: "task",
      data: { ...data, assigneeIds: assignees.map((assignee) => assignee.id) },
    };
  }
  // The server re-validates every operation; the patch here is already typed by field.
  const data = patchFrom(row.value) as Extract<AiApplyOperation, { op: "update" }>["data"];
  return row.kind === "update-event"
    ? { op: "update", entity: "event", id: row.value.id, data }
    : { op: "update", entity: "task", id: row.value.id, data };
}
