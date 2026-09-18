import type { RosterMember, Task } from "@ctp/shared";
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

/**
 * Read-only detail for one task. `taskSchema` has no description field, so this
 * shows only what a task actually carries — inventing a body here would be a
 * field the API never returns.
 */
export function TaskDetailDialog({
  task,
  members,
  onClose,
}: {
  task: Task | undefined;
  members: RosterMember[];
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
