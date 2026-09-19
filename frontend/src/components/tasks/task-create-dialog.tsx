import {
  createTaskSchema,
  taskPrioritySchema,
  type CreateTask,
  type EventSummary,
  type RosterMember,
} from "@ctp/shared";
import { useState, type FormEvent } from "react";
import { AssigneeField } from "@/components/tasks/assignee-field";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const selectBase =
  "w-full cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The create form both boards open — `/tasks` and an event's Tasks tab.
 *
 * The dialog owns its own draft: the deadline and the assignments stay local
 * until submit, because the create body is a single POST and writing per toggle
 * would have to create the task before it has been filled in. A closed dialog
 * forgets that draft. The caller owns the open flag and the create itself, so
 * the board on the page behind the dialog is the one that gains the card.
 *
 * `lockedEvent` is the difference between the two callers. `/tasks` offers the
 * link as a choice (`events`); the event page opens this from inside one event,
 * where the link is not a choice — a picker with a single option would be a
 * control that cannot be operated, so it is stated rather than offered.
 */
export function TaskCreateDialog({
  open,
  onOpenChange,
  events,
  members,
  lockedEvent,
  busy,
  error,
  onCreate,
}: {
  open: boolean;
  /** Called with `false` after a cancel and after a create the server accepted. */
  onOpenChange: (open: boolean) => void;
  /** The events a task can be linked to. Absent while that list is still loading. */
  events?: EventSummary[];
  members: RosterMember[];
  /** Set when the task belongs to a known event; replaces the link picker. */
  lockedEvent?: EventSummary;
  busy: boolean;
  /** The view model's last mutation failure, shown in place so nothing typed is lost. */
  error?: string;
  /** Resolves `true` once the task exists, which is what closes the dialog. */
  onCreate: (input: CreateTask) => Promise<boolean>;
}) {
  const [validationError, setValidationError] = useState<string>();
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState<Date | null>(null);
  // The member picker's popover portals into the dialog, not `document.body` —
  // body sits outside the scroll-lock shard, so a popover there cannot scroll.
  // `DateTimePicker` shares it for the same reason. See `AssigneeField`.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  function setOpen(next: boolean) {
    onOpenChange(next);
    // Closing forgets the draft, so reopening starts clean rather than showing
    // the assignments from the abandoned attempt.
    if (!next) {
      setValidationError(undefined);
      setAssigneeIds([]);
      setDueAt(null);
      setPortalTarget(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // The shared schema owns the shape: it trims the title, rejects one that is
    // blank once trimmed, collapses an empty description to `null`, and fills the
    // defaults the API would apply anyway.
    const parsed = createTaskSchema.safeParse({
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      priority: data.get("priority"),
      // A locked event is not a form field, so it never appears in `FormData`.
      eventId: lockedEvent?.id ?? (String(data.get("eventId") ?? "") || undefined),
      // From the picker's draft, not `FormData`: the control is a popover, not a
      // native form field, so it has no entry in the form's own data.
      dueAt: dueAt ?? undefined,
      // From the picker's draft, not `FormData`: the assignment control is not a
      // native form field, since it has to be searchable.
      assigneeIds,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Review the task details.");
      return;
    }
    setValidationError(undefined);
    void onCreate(parsed.data).then((created) => {
      // On failure the dialog stays open, so nothing typed is lost.
      if (created) setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent ref={setPortalTarget} size="wide">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add a task</DialogTitle>
          <DialogDescription>
            {lockedEvent
              ? `Adds a card to ${lockedEvent.title}. The due date and assignees are optional and can be set later.`
              : "The event, due date and assignees are optional and can be set later."}
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
          <div className="grid shrink-0 gap-2">
            <Label htmlFor="new-task-title">Task</Label>
            <Input
              id="new-task-title"
              name="title"
              autoComplete="off"
              placeholder="e.g. Confirm venue access"
              maxLength={200}
              required
              className="h-10 text-base"
            />
          </div>

          {/* The metadata strip: everything bounded goes above the description,
              stacked on phones and three across from `sm`. */}
          <div className="grid shrink-0 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="new-task-priority">Priority</Label>
              <select
                id="new-task-priority"
                name="priority"
                defaultValue="medium"
                className={cn(selectBase, "h-9")}
              >
                {taskPrioritySchema.options.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-task-due">Due date</Label>
              <DateTimePicker
                id="new-task-due"
                label="due date"
                timeLabel="Deadline time"
                value={dueAt}
                onChange={setDueAt}
                portalTarget={portalTarget}
                disabled={busy}
              />
            </div>

            <div className="grid gap-2">
              {lockedEvent ? (
                <>
                  {/* Stated, not offered: the link is fixed on this page, and a
                      disabled control reads as a fault rather than a fact. */}
                  <span className="text-sm leading-none font-medium">Event</span>
                  <p className="flex h-9 items-center truncate rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                    {lockedEvent.title}
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="new-task-event">Linked event</Label>
                  <select
                    id="new-task-event"
                    name="eventId"
                    defaultValue=""
                    // No fabricated choices while the list is still loading.
                    disabled={!events}
                    className={cn(selectBase, "h-9")}
                  >
                    <option value="">No event</option>
                    {events?.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          {/* A fixed half-height: the description stays the largest single
              field without the dialog's slack deciding how tall it is. */}
          <div className="grid min-h-0 grow-0 basis-72 grid-rows-[auto_minmax(0,1fr)] gap-2">
            <Label htmlFor="new-task-description">Description</Label>
            <textarea
              id="new-task-description"
              name="description"
              maxLength={2000}
              placeholder="Add a more detailed description…"
              className="h-full min-h-24 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
            />
          </div>

          <div className="grid shrink-0 gap-2">
            {/* Same searchable picker as the task modal. Selection is local
                state until submit, because the create body is one POST and a
                write per toggle would create the task before it is filled in. */}
            <span className="text-sm leading-none font-medium">Assignees</span>
            <AssigneeField
              members={members}
              selectedIds={assigneeIds}
              onChange={setAssigneeIds}
              portalTarget={portalTarget}
              subject="this task"
              idPrefix="new-task"
              busy={busy}
            />
          </div>

          {validationError && (
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {validationError}
            </p>
          )}
          {error && (
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {error}. Try again.
            </p>
          )}

          <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
