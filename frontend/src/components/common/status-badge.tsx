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
 *
 * EVERY TINTED PAIR DEFINES BOTH HALVES OF THE DARK VARIANT. `dark:` swaps the
 * background to the `-950` shade, so the text colour has to swap with it:
 * leaving the light `-700`/`-800` text on that background measures 2.1–2.8:1 and
 * fails WCAG AA (R13), which is the state this file shipped in until these pairs
 * were completed. The dark shades measure 9.94:1 (emerald), 12.03:1 (amber) and
 * 8.51:1 (red) — see docs/accessibility.md. Naming the pairs once rather than
 * inlining fifteen class strings is what makes "a tint without its dark text" a
 * shape that cannot be written here; the colocated test asserts it anyway.
 */
const tints = {
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  // Token pairs: `accent` and `secondary` already redefine both halves under
  // `dark` in index.css, so they take no variant here.
  accent: "bg-accent text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground",
} as const;

export const statusStyles: Record<Status, { label: string; className: string }> = {
  planning: { label: "Planning", className: tints.accent },
  live: { label: "Live", className: tints.emerald },
  wrapped: { label: "Wrapped", className: tints.secondary },
  cancelled: { label: "Cancelled", className: tints.red },
  pending: { label: "Pending", className: tints.amber },
  approved: { label: "Approved", className: tints.accent },
  paid: { label: "Paid", className: tints.emerald },
  rejected: { label: "Rejected", className: tints.red },
  todo: { label: "To Do", className: tints.secondary },
  in_progress: { label: "In Progress", className: tints.accent },
  blocked: { label: "Blocked", className: tints.red },
  done: { label: "Done", className: tints.emerald },
  on_track: { label: "On Track", className: tints.emerald },
  at_risk: { label: "At Risk", className: tints.amber },
  critical: { label: "Critical", className: tints.red },
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
