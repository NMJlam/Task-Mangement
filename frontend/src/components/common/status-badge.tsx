import type { EventStatus, ExpenseStatus, Risk, TaskStatus } from "@ctp/shared";
import { cn } from "@/lib/utils";

type Status = EventStatus | ExpenseStatus | Risk | TaskStatus;

/**
 * The status vocabulary the app renders, in one place. Exported because the
 * calendar's event chips colour themselves by the SAME event status the badge
 * shows: two copies of "what does `live` look like" is how a chip and a badge
 * drift into disagreeing about the same row.
 *
 * A status here is a TUI tag - `[Live]` - not a filled pill: coloured text on
 * the panel, brackets drawn by the `.tag` class in `index.css` so the element's
 * text content stays exactly its label for screen readers and tests.
 *
 * Colours come from `--ok` / `--warn` / `--danger` / `--muted-foreground` and
 * the one accent (`--ring`). Both themes define every one of them, so there is
 * no `dark:` half that can be forgotten - which is the failure this file used to
 * ship, at 2.1-2.8:1. See docs/accessibility.md.
 */
export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "accent";

/** Text colour for a tag on a panel. */
export const toneText: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-ring",
};

/**
 * The same tone as a wash, for a chip that has to hold two lines of its own
 * text (the calendar). The hue lives in the wash; the text is always ink, not
 * the tone colour.
 *
 * That is deliberate, and it is measured: `ring` (#cc3700) on its own 15% wash
 * over `--card` is 3.71:1 in light mode and would fail AA, while ink on the same
 * wash is 13.42:1. Keeping one rule for every tone beats a rule that holds for
 * green, amber and red but not orange. Numbers: docs/accessibility.md.
 */
export const toneChip: Record<StatusTone, string> = {
  neutral: "bg-foreground/5 text-muted-foreground",
  ok: "bg-ok/15 text-foreground",
  warn: "bg-warn/15 text-foreground",
  danger: "bg-danger/15 text-foreground",
  accent: "bg-ring/15 text-foreground",
};

export const statusStyles: Record<Status, { label: string; tone: StatusTone }> = {
  planning: { label: "Planning", tone: "accent" },
  live: { label: "Live", tone: "ok" },
  wrapped: { label: "Wrapped", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "accent" },
  paid: { label: "Paid", tone: "ok" },
  rejected: { label: "Rejected", tone: "danger" },
  todo: { label: "To Do", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "accent" },
  blocked: { label: "Blocked", tone: "danger" },
  done: { label: "Done", tone: "ok" },
  on_track: { label: "On Track", tone: "ok" },
  at_risk: { label: "At Risk", tone: "warn" },
  critical: { label: "Critical", tone: "danger" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const style = statusStyles[status];

  return (
    <span
      className={cn(
        "tag inline-flex w-fit items-center text-xs leading-none font-medium tracking-[0.02em] uppercase",
        toneText[style.tone],
        className,
      )}
    >
      {style.label}
    </span>
  );
}
