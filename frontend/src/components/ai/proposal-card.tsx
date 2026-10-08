import type { AiApplyOperation, AiResolvedProposal, RosterMember } from "@ctp/shared";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { CreateEventRow } from "./create-event-row";
import { CreateTaskRow } from "./create-task-row";
import { DiffRow } from "./diff-row";
import { Button } from "@/components/ui/button";
import {
  deriveSections,
  rowErrors,
  rowOperation,
  SECTION_LABELS,
  type CardRow,
  type SectionKind,
} from "@/lib/ai-sections";

export type ApplyStats = { proposed: number; kept: number; edited: number };

/** One row on the card, with what the model proposed kept beside it for the `edited` count. */
type Entry = { row: CardRow; original: CardRow | null; checked: boolean };

const SECTION_ORDER: SectionKind[] = [
  "create-event",
  "create-task",
  "update-event",
  "update-task",
  "reassign-task",
];
const SECTION_ICONS = {
  "create-event": Plus,
  "create-task": Plus,
  "update-event": Pencil,
  "update-task": Pencil,
  "reassign-task": ArrowLeftRight,
} as const;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What the footer will do, in the member's words: "Create 1 event + 7 tasks", "Apply 4 changes". */
function footerLabel(active: readonly Entry[]): string {
  const events = active.filter((entry) => entry.row.kind === "create-event").length;
  const tasks = active.filter((entry) => entry.row.kind === "create-task").length;
  if (active.length === 0) return "Nothing selected";
  if (events + tasks < active.length) return `Apply ${plural(active.length, "change")}`;
  return `Create ${[events && plural(events, "event"), tasks && plural(tasks, "task")].filter(Boolean).join(" + ")}`;
}

const changed = (entry: Entry) =>
  entry.original !== null &&
  JSON.stringify(entry.row.value) !== JSON.stringify(entry.original.value);

/**
 * The confirmation card for one assistant turn. Every row is checked and
 * editable in place; nothing is written until the member presses the footer,
 * whose label says exactly what will happen. Unchecking a staged event drops
 * the tasks that would have hung off it, so the card never applies an orphan.
 */
export function ProposalCard({
  proposal,
  members,
  onApply,
  onDiscard,
  busy = false,
  portalTarget = null,
}: {
  proposal: AiResolvedProposal;
  members: RosterMember[];
  onApply: (operations: AiApplyOperation[], stats: ApplyStats) => void;
  onDiscard: () => void;
  busy?: boolean;
  portalTarget?: HTMLElement | null;
}) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    deriveSections(proposal).flatMap((section) =>
      section.rows.map((row) => ({ row, original: row, checked: true })),
    ),
  );
  const [added, setAdded] = useState(0);

  const update = (key: string, patch: Partial<Entry>) =>
    setEntries((current) =>
      current.map((entry) => (entry.row.key === key ? { ...entry, ...patch } : entry)),
    );

  const droppedRefs = new Set(
    entries.flatMap((entry) =>
      entry.row.kind === "create-event" && !entry.checked ? [entry.row.value.ref] : [],
    ),
  );
  const orphaned = (entry: Entry) =>
    entry.row.kind === "create-task" &&
    entry.row.value.eventRef !== undefined &&
    droppedRefs.has(entry.row.value.eventRef);

  const active = entries.filter((entry) => entry.checked && !orphaned(entry));
  const invalid = active.some((entry) => Object.keys(rowErrors(entry.row)).length > 0);

  function apply() {
    const proposed = entries.filter((entry) => entry.original !== null);
    const kept = active.filter((entry) => entry.original !== null);
    onApply(
      active.map((entry) => rowOperation(entry.row)),
      { proposed: proposed.length, kept: kept.length, edited: kept.filter(changed).length },
    );
  }

  function addTask() {
    const key = `added-${added}`;
    setAdded((count) => count + 1);
    setEntries((current) => [
      ...current,
      {
        row: {
          key,
          kind: "create-task",
          value: { title: "", priority: "medium", dueAt: null, assignees: [] },
        },
        original: null,
        checked: true,
      },
    ]);
  }

  function renderRow(entry: Entry) {
    const { row } = entry;
    const common = {
      rowKey: row.key,
      checked: entry.checked,
      onCheckedChange: (checked: boolean) => update(row.key, { checked }),
      errors: rowErrors(row),
    };
    if (row.kind === "create-event") {
      return (
        <CreateEventRow
          key={row.key}
          {...common}
          label={entry.original?.value.title || "New event"}
          value={row.value}
          onChange={(value) => update(row.key, { row: { ...row, value } })}
          portalTarget={portalTarget}
        />
      );
    }
    if (row.kind === "create-task") {
      return (
        <CreateTaskRow
          key={row.key}
          {...common}
          label={
            (entry.original?.kind === "create-task" && entry.original.value.title) || "New task"
          }
          value={row.value}
          onChange={(value) => update(row.key, { row: { ...row, value } })}
          members={members}
          disabled={orphaned(entry)}
          portalTarget={portalTarget}
        />
      );
    }
    return (
      <DiffRow
        key={row.key}
        {...common}
        value={row.value}
        onChange={(value) => update(row.key, { row: { ...row, value } })}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain">
        {SECTION_ORDER.map((kind) => {
          const rows = entries.filter((entry) => entry.row.kind === kind);
          if (rows.length === 0 && !(kind === "create-task" && entries.length > 0)) return null;
          const Icon = SECTION_ICONS[kind];
          return (
            <section
              key={kind}
              aria-labelledby={`ai-section-${kind}`}
              className="border-b last:border-b-0"
            >
              <h3
                id={`ai-section-${kind}`}
                className="flex items-center gap-2 bg-foreground/5 px-4 py-2 text-sm font-medium"
              >
                <Icon aria-hidden="true" className="size-4" />
                {SECTION_LABELS[kind]}
              </h3>
              <div className="divide-y">{rows.map(renderRow)}</div>
              {kind === "create-task" ? (
                <Button variant="ghost" size="sm" className="m-2" onClick={addTask} disabled={busy}>
                  <Plus aria-hidden="true" />
                  Add a task
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        <Button onClick={apply} disabled={busy || invalid || active.length === 0}>
          {footerLabel(active)}
        </Button>
      </div>
    </div>
  );
}
