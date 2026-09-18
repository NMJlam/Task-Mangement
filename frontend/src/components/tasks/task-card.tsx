import type { Task } from "@ctp/shared";
import { useDraggable } from "@dnd-kit/react";
import { GripVertical, UserRound } from "lucide-react";
import { PriorityDot } from "@/components/common/priority-dot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * One task on a board.
 *
 * Two real buttons, deliberately separate. The card-wide overlay opens the
 * details — it carries the accessible name because its content is sibling
 * markup, not its own text — and the handle beside the title is the only drag
 * activator. Making the whole card the handle would leave Enter and Space with
 * two meanings at once, and a drag that starts from the handle leaves the body
 * free for the click, Enter and Space that open the dialog.
 *
 * The status selector is gone: the column a card sits in IS its status, and the
 * drag is what changes it.
 */
export function TaskCard({
  task,
  disabled,
  assigneeCount,
  eventTitle,
  onOpen,
}: {
  task: Task;
  disabled: boolean;
  /** Shown only where assignments are editable (the `/tasks` board). */
  assigneeCount?: number;
  eventTitle?: string;
  onOpen: (task: Task) => void;
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: task.id,
    type: "task",
    disabled,
    data: { title: task.title, status: task.status },
  });

  return (
    <Card
      ref={ref}
      className={cn(
        "relative gap-4 py-4 shadow-none transition-[border-color,box-shadow,opacity] motion-reduce:transition-none",
        isDragging ? "border-ring opacity-60" : "hover:border-input hover:shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        aria-label={`Open ${task.title}`}
        className="absolute inset-0 cursor-pointer rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <CardContent className="px-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5">
            <PriorityDot priority={task.priority} />
          </span>
          <h3 className="min-w-0 flex-1 text-sm leading-5 font-medium">{task.title}</h3>
          <Button
            ref={handleRef}
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={`Move ${task.title}`}
            className="relative z-10 -mt-1.5 -mr-1.5 touch-none text-muted-foreground"
          >
            <GripVertical aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {task.dueAt ? `Due ${shortDate.format(task.dueAt)}` : "No due date"}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {eventTitle && (
              <span className="max-w-36 truncate rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {eventTitle}
              </span>
            )}
            {assigneeCount !== undefined && (
              <span
                className="flex items-center gap-1 tabular-nums"
                title={assigneeCount === 1 ? "1 assignee" : `${assigneeCount} assignees`}
              >
                <UserRound aria-hidden="true" className="size-3.5" />
                {assigneeCount}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
