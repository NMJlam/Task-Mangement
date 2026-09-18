import type { Task } from "@ctp/shared";
import { useDraggable } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
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
  eventTitle,
  onOpen,
}: {
  task: Task;
  disabled: boolean;
  /** The linked event's name, when the task has one and the parent resolved it. */
  eventTitle?: string;
  onOpen: (task: Task) => void;
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: task.id,
    type: "task",
    disabled,
    // The accessibility announcements read the task back out of the entity:
    // the title names it, the status renders as the column it came from.
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
          {/* Relative and lifted: it must keep its own clicks above the overlay.
              `touch-none` is what lets a touch drag start here at all — without
              it the browser claims the gesture for panning and the pointer
              stream is cancelled before dnd-kit sees a move. Only the handle
              opts out; the card body still scrolls the page. */}
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
          {eventTitle && (
            <span className="max-w-36 truncate rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
              {eventTitle}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
