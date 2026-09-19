import {
  taskPrioritySchema,
  type EventSummary,
  type RosterMember,
  type Task,
  type UpdateTask,
} from "@ctp/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/common/status-badge";
import { AssigneeField } from "@/components/tasks/assignee-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * One task: what it is, who holds it, and — when `onUpdate` is given — the
 * description field, the priority selector and the member picker behind the
 * small `+` beside the assignee list.
 *
 * Every field is optional to edit, so a caller that only reads the task (a
 * board with no mutation wired up) still gets a coherent dialog: the same
 * controls render as text instead.
 */
export function TaskDetailDialog({
  task,
  members,
  events,
  busy = false,
  onEventChange,
  onClose,
  onUpdate,
  error,
}: {
  task: Task | undefined;
  members: RosterMember[];
  events?: EventSummary[];
  busy?: boolean;
  onEventChange?: (task: Task, eventId: string | null) => void;
  onClose: () => void;
  onUpdate?: (patch: UpdateTask) => void;
  error?: string;
}) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      {task && (
        <TaskDetailBody
          key={task.id}
          task={task}
          members={members}
          events={events}
          onEventChange={onEventChange}
          onUpdate={onUpdate}
          busy={busy}
          error={error}
        />
      )}
    </Dialog>
  );
}

function TaskDetailBody({
  task,
  members,
  events,
  onEventChange,
  onUpdate,
  busy,
  error,
}: {
  task: Task;
  members: RosterMember[];
  events?: EventSummary[];
  onEventChange?: (task: Task, eventId: string | null) => void;
  onUpdate?: (patch: UpdateTask) => void;
  busy: boolean;
  error?: string;
}) {
  // The popover portals into the dialog content, not `document.body`. Body sits
  // OUTSIDE the scroll-lock shard that `Dialog` installs, so a popover there has
  // every wheel event cancelled (`react-remove-scroll`) and its list cannot
  // scroll. Inside the dialog it is a descendant of the shard and scrolls.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  // Only the read-only row needs this: the editable branch is a `<select>` whose
  // options carry the titles. `undefined` when no list was supplied, which is a
  // missing label rather than a missing link.
  const linkedEventTitle = task.eventId
    ? events?.find((event) => event.id === task.eventId)?.title
    : undefined;

  return (
    <DialogContent ref={setPortalTarget} size="wide" aria-describedby={undefined}>
      <DialogHeader className="shrink-0">
        <DialogTitle>{task.title}</DialogTitle>
        <DialogDescription>
          {task.dueAt ? `Due ${fullDate.format(task.dueAt)}` : "No due date set"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <StatusBadge status={task.status} />
        {task.aiRunId && (
          <span className="inline-flex w-fit items-center rounded-full bg-accent px-2 py-1 text-xs leading-none font-medium text-accent-foreground">
            AI drafted
          </span>
        )}
      </div>

      <dl className="grid shrink-0 gap-3 border-t pt-4 text-sm">
        {/* Label above the controls on narrow dialogs, side-by-side from `sm`:
            the select plus the `View event` button do not fit beside the label
            at phone widths. */}
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <dt>
            {onEventChange ? (
              <label htmlFor={`task-event-${task.id}`} className="text-muted-foreground">
                Linked event
              </label>
            ) : (
              <span className="text-muted-foreground">Linked event</span>
            )}
          </dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            {onEventChange ? (
              <select
                id={`task-event-${task.id}`}
                value={task.eventId ?? ""}
                disabled={busy || !events}
                onChange={(event) => onEventChange(task, event.target.value || null)}
                className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-56"
              >
                <option value="">No event</option>
                {task.eventId && !events?.some((event) => event.id === task.eventId) && (
                  <option value={task.eventId}>Current event</option>
                )}
                {events?.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            ) : (
              // A row that names only the action would leave the reader unable to
              // tell which event the task belongs to; show the title when the
              // caller supplied an event list, otherwise just the link.
              <span className="min-w-0 truncate text-muted-foreground">
                {task.eventId ? (linkedEventTitle ?? "") : "No event"}
              </span>
            )}
            {/* The card's event badge stays a label; navigation lives here, where
                the link is unambiguous. `variant="link"` is wrong here: `primary`
                is the body foreground colour in this palette, so it renders as
                plain text with no affordance at all. */}
            {task.eventId && (
              <Button variant="outline" asChild>
                <Link to={`/events/${task.eventId}`}>View event</Link>
              </Button>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Assignees</dt>
          <dd className="min-w-0 flex-1">
            <AssigneeField
              members={members}
              selectedIds={task.assigneeIds}
              onChange={onUpdate && ((next) => onUpdate({ assigneeIds: next }))}
              portalTarget={portalTarget}
              subject={task.title}
              idPrefix={task.id}
              busy={busy}
              error={error}
            />
          </dd>
        </div>
        {onUpdate ? (
          <div className="flex items-center justify-between gap-3">
            <dt>
              <label htmlFor={`task-priority-${task.id}`} className="text-muted-foreground">
                Priority
              </label>
            </dt>
            <dd>
              <select
                id={`task-priority-${task.id}`}
                value={task.priority}
                disabled={busy}
                // Every change writes immediately: there is no draft to lose and
                // no Save button, exactly as the assignee rows behave.
                onChange={(event) =>
                  onUpdate({ priority: taskPrioritySchema.parse(event.target.value) })
                }
                className="h-9 max-w-56 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {taskPrioritySchema.options.map((priority) => (
                  <option key={priority} value={priority}>
                    {capitalise(priority)}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        ) : (
          <Row label="Priority" value={capitalise(task.priority)} />
        )}
        {task.completedAt && <Row label="Completed" value={stamp.format(task.completedAt)} />}
        <Row label="Created" value={stamp.format(task.createdAt)} />
        <Row label="Last updated" value={stamp.format(task.updatedAt)} />
      </dl>

      {/* Keyed on the stored description, so once a save comes back the field
          shows what the server kept (trimmed, or empty for cleared) instead of
          the raw keystrokes. Typing does not change the stored value, so this
          never remounts mid-edit. */}
      <Description key={task.description ?? ""} task={task} onUpdate={onUpdate} busy={busy} />
    </DialogContent>
  );
}

/**
 * Trello's card back: a labelled multi-line field, saved on blur.
 *
 * Blur-save rather than a Save button keeps the card feeling like a card, and
 * the value is committed only when it actually changed — so tabbing through the
 * dialog never writes. Read-only when `onUpdate` is absent, in which case the
 * text is shown as prose.
 */
function Description({
  task,
  onUpdate,
  busy,
}: {
  task: Task;
  onUpdate?: (patch: UpdateTask) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(task.description ?? "");
  const changed = draft.trim() !== (task.description ?? "");

  if (!onUpdate) {
    return (
      <section className="grid min-h-0 grow-0 basis-72 grid-rows-[auto_minmax(0,1fr)] gap-2 border-t pt-4">
        <h2 className="text-sm font-medium">Description</h2>
        {task.description ? (
          <p className="overflow-y-auto overscroll-contain text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
            {task.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
      </section>
    );
  }

  return (
    <section className="grid min-h-0 grow-0 basis-72 grid-rows-[auto_minmax(0,1fr)] gap-2 border-t pt-4">
      <Label htmlFor={`description-${task.id}`}>Description</Label>
      <textarea
        id={`description-${task.id}`}
        name="description"
        value={draft}
        disabled={busy}
        maxLength={2000}
        placeholder="Add a more detailed description…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          // An emptied field clears the description (the schema normalises ""
          // to null), and an untouched field writes nothing at all.
          if (changed) onUpdate({ description: draft });
        }}
        className="h-full min-h-24 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
      />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
