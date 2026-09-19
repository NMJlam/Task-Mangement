import { CalendarDays } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The value's local `HH:MM`, or `""` when there is no value. */
function timeOf(value: Date | null): string {
  if (!value) return "";
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

/** `true` for what a native `type="time"` reports — `HH:MM`, optionally with seconds. */
function isTime(value: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(value);
}

/**
 * The instant a local day plus a local `HH:MM` names.
 *
 * `new Date(y, m, d, h, min)` and NOT `Date.parse("YYYY-MM-DDTHH:MM")`: the
 * constructor takes local components directly, so the deadline is the wall-clock
 * time the user picked. Parsing a zone-less string is implementation-defined for
 * date-only forms and, for date-time forms, silently UTC — either way the stored
 * instant lands hours off. The rest of the app renders with `Intl` in local time
 * for the same reason.
 */
function compose(day: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours!, minutes!);
}

/**
 * A visual day-plus-time picker — the one control for every date this app edits
 * (a task's deadline, an event's start and end).
 *
 * A day grid rather than a `datetime-local` input: the native control's date
 * affordance is a browser-specific spinner with no month context, and it renders
 * differently enough across engines that two dialogs looked like different
 * products. `react-day-picker` supplies the accessible grid; the time stays a
 * native field, because the platform's time entry (and its keyboard/segmented
 * behaviour) is better than anything hand-rolled.
 *
 * `label` is a noun phrase ("due date", "start date") — the trigger's empty text,
 * the popover's name and the clear action are all built from it, so the same
 * control reads correctly in both domains.
 *
 * Controlled: the caller owns the value, so a create form can hold a draft until
 * submit while a card writes through on Apply. `portalTarget` follows
 * `AssigneeField` — a popover portaled to `document.body` sits outside the
 * dialog's scroll-lock shard and has every wheel event cancelled, so it portals
 * into the dialog content when there is one.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  label,
  timeLabel = "Time",
  allowClear = true,
  disabled = false,
  portalTarget = null,
}: {
  id: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Noun phrase the trigger, popover and clear action are worded from. */
  label: string;
  timeLabel?: string;
  /** Off for a required instant, where clearing is not a state the caller accepts. */
  allowClear?: boolean;
  disabled?: boolean;
  portalTarget?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date | undefined>(value ?? undefined);
  const [time, setTime] = useState(timeOf(value));
  const timeId = `${id}-time`;
  // A day with no time is not an instant, and guessing midnight would invent a
  // fact the user did not state — so Apply stays disabled until both are given.
  const canApply = day !== undefined && isTime(time);

  function handleOpenChange(next: boolean) {
    // Opening always starts from the stored value, so a cancelled attempt leaves
    // nothing half-edited behind.
    if (next) {
      setDay(value ?? undefined);
      setTime(timeOf(value));
    }
    setOpen(next);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(
            "h-9 w-full justify-start font-normal",
            !value && "text-muted-foreground",
            open && "border-ring ring-3 ring-ring/50",
          )}
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span className="truncate">{value ? stamp.format(value) : `Select ${label}`}</span>
        </Button>
      </Popover.Trigger>

      <Popover.Portal container={portalTarget}>
        <Popover.Content
          aria-label={`Pick the ${label}`}
          align="start"
          side="bottom"
          sideOffset={6}
          // Kept inside the dialog card: without a boundary the popper is measured
          // against the viewport, so it hangs below the modal and covers the
          // description instead of shifting to stay within it.
          collisionBoundary={portalTarget ?? undefined}
          collisionPadding={12}
          className="z-50 grid gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
        >
          <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={day} />

          <div className="grid gap-1.5 border-t pt-3">
            <Label htmlFor={timeId} className="text-xs text-muted-foreground">
              {timeLabel}
            </Label>
            <Input
              id={timeId}
              name={timeId}
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="h-9"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Only offered when there is something to clear, so the popover does
                not carry an action that would do nothing. */}
            {allowClear && value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear {label}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canApply}
                onClick={() => {
                  if (!day || !isTime(time)) return;
                  onChange(compose(day, time));
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
