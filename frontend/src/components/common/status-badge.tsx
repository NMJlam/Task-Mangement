import type { EventStatus, ExpenseStatus, Risk, TaskStatus } from "@ctp/shared";
import { cn } from "@/lib/utils";

type Status = EventStatus | ExpenseStatus | Risk | TaskStatus;

/**
 * The status vocabulary the app renders, in one place. Exported because the
 * calendar's event chips colour themselves by the SAME event status the badge
 * shows: two copies of "what does `live` look like" is how a chip and a badge
 * drift into disagreeing about the same row.
 *
 * The class names are the contrast-safe pairs the palette's contrast table was
 * computed against — `text-emerald-700` on `bg-emerald-50` and friends. They are
 * intended to be applied to a chip that keeps its own text colours, so a chip
 * must not add a text colour of its own on top of these.
 */
export const statusStyles: Record<Status, { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-accent text-accent-foreground" },
  live: { label: "Live", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" },
  wrapped: { label: "Wrapped", className: "bg-secondary text-secondary-foreground" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700 dark:bg-red-950" },
  pending: { label: "Pending", className: "bg-amber-50 text-amber-800 dark:bg-amber-950" },
  approved: { label: "Approved", className: "bg-accent text-accent-foreground" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 dark:bg-red-950" },
  todo: { label: "To Do", className: "bg-secondary text-secondary-foreground" },
  in_progress: { label: "In Progress", className: "bg-accent text-accent-foreground" },
  blocked: { label: "Blocked", className: "bg-red-50 text-red-700 dark:bg-red-950" },
  done: { label: "Done", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" },
  on_track: { label: "On Track", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" },
  at_risk: { label: "At Risk", className: "bg-amber-50 text-amber-800 dark:bg-amber-950" },
  critical: { label: "Critical", className: "bg-red-50 text-red-700 dark:bg-red-950" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const style = statusStyles[status];

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-1 text-xs leading-none font-medium",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
