import type { EventSummary, RosterMember, Task } from "@ctp/shared";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Task detail, plus the event link control when the parent supplies one. */
export function TaskDetailDialog({
  task,
  members,
  events,
  busy,
  onEventChange,
  onClose,
}: {
  task: Task | undefined;
  members: RosterMember[];
  events?: EventSummary[];
  busy?: boolean;
  onEventChange?: (task: Task, eventId: string | null) => void;
  onClose: () => void;
}) {
  const assignee = members.find((member) => member.id === task?.assignee);
  const assigneeName = assignee?.name || assignee?.email;

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      {task && (
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
            <DialogDescription>
              {task.dueAt ? `Due ${fullDate.format(task.dueAt)}` : "No due date set"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="inline-flex w-fit items-center rounded-full bg-secondary px-2 py-1 text-xs leading-none font-medium text-secondary-foreground capitalize">
              {task.priority}
            </span>
            {task.aiRunId && (
              <span className="inline-flex w-fit items-center rounded-full bg-accent px-2 py-1 text-xs leading-none font-medium text-accent-foreground">
                AI drafted
              </span>
            )}
          </div>

          <dl className="grid gap-3 border-t pt-4 text-sm">
            {onEventChange && (
              <div className="flex items-center justify-between gap-3">
                <dt>
                  <label htmlFor={`task-event-${task.id}`} className="text-muted-foreground">
                    Linked event
                  </label>
                </dt>
                <dd>
                  <select
                    id={`task-event-${task.id}`}
                    value={task.eventId ?? ""}
                    disabled={busy || !events}
                    onChange={(event) => onEventChange(task, event.target.value || null)}
                    className="h-9 max-w-56 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Assignee</dt>
              <dd>
                {assigneeName ? (
                  <span className="flex items-center gap-2">
                    <UserAvatar name={assigneeName} className="size-6 text-[0.625rem]" />
                    {assigneeName}
                  </span>
                ) : (
                  // The task may genuinely have no assignee, or the member may have
                  // left — either way, do not guess at a name.
                  <span className="text-muted-foreground">
                    {task.assignee ? "Former Member" : "Unassigned"}
                  </span>
                )}
              </dd>
            </div>
            <Row label="Priority" value={capitalise(task.priority)} />
            {task.completedAt && <Row label="Completed" value={stamp.format(task.completedAt)} />}
            <Row label="Created" value={stamp.format(task.createdAt)} />
            <Row label="Last updated" value={stamp.format(task.updatedAt)} />
          </dl>
        </DialogContent>
      )}
    </Dialog>
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
