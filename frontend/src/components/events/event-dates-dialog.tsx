import type { EventDetail } from "@ctp/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { EventDates, EventDatesSave } from "@/lib/event-dates";

/**
 * Reschedule one event: the start and, optionally, the end.
 *
 * Both fields are the same visual picker the task dialogs use, so a date is
 * chosen the same way everywhere. The start is required and cannot be cleared —
 * an event without one is not a state the API accepts — while the end has a real
 * empty state ("no end time"), which is why only that one offers Clear.
 *
 * `onSave` is the caller's transport, so the event page writes through
 * `useEvent` and the calendar through `useCalendar` — this component never
 * fetches. It must not throw; a refusal comes back as `{ ok: false }`.
 */
export function EventDatesDialog({
  event,
  onClose,
  onSave,
  onSaved,
}: {
  /** `undefined` closes the dialog — the same contract as `TaskDetailDialog`. */
  event: EventDetail | undefined;
  onClose: () => void;
  onSave: (dates: EventDates) => Promise<EventDatesSave>;
  /** Warnings the server attached to the save (a task deadline left behind). */
  onSaved: (warnings: string[]) => void;
}) {
  return (
    <Dialog open={Boolean(event)} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed on the event, so reopening (or opening a different event) starts
          from what is stored rather than the previous draft. */}
      {event && (
        <EventDatesForm
          key={event.id}
          event={event}
          onClose={onClose}
          onSave={onSave}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function EventDatesForm({
  event,
  onClose,
  onSave,
  onSaved,
}: {
  event: EventDetail;
  onClose: () => void;
  onSave: (dates: EventDates) => Promise<EventDatesSave>;
  onSaved: (warnings: string[]) => void;
}) {
  const [startsAt, setStartsAt] = useState<Date | null>(event.startsAt);
  const [endsAt, setEndsAt] = useState<Date | null>(event.endsAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // The popovers portal into the dialog content, not `document.body`: body sits
  // outside the scroll-lock shard `Dialog` installs, so a popover there has every
  // wheel event cancelled. Same arrangement as the task dialogs — see
  // `AssigneeField`.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  // The same rule the route enforces (`assertEventDates`); applied here first so
  // the user is told before a round trip, not after one.
  const inverted = startsAt !== null && endsAt !== null && endsAt < startsAt;

  /**
   * Moving the start PAST the end carries the end along, keeping the span the
   * event already had — the same "the event moved, its length did not" a drag
   * applies. Without it, one gesture ("this happens later now") leaves a disabled
   * Save and "the end must not precede the start" to untangle by hand.
   *
   * Only on a crossing, and measured as a DURATION rather than a whole-day shift:
   * moving the start from 10:00 to 18:00 crosses an end at 13:00 within the same
   * day, which a day-based shift would leave inverted. An earlier start, or one
   * that stays inside the range, leaves an end the user set exactly where it is.
   */
  function changeStart(next: Date | null) {
    const previous = startsAt;
    setStartsAt(next);
    if (!next || !endsAt || !previous || next <= endsAt) return;
    setEndsAt(new Date(next.getTime() + (endsAt.getTime() - previous.getTime())));
  }

  async function submit() {
    if (!startsAt || inverted) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await onSave({ startsAt, endsAt });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(result.warnings);
      onClose();
    } catch {
      // A transport that threw still has to clear the busy state, or the dialog
      // sits on "Saving…" with no way forward.
      setError("Couldn't save the dates. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent ref={setPortalTarget} aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>Edit dates</DialogTitle>
        <DialogDescription>
          Move {event.title} to a new start. An end time is optional.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="event-start">Start date</Label>
          <DateTimePicker
            id="event-start"
            label="start date"
            timeLabel="Start time"
            // Required: an event always has a start, so there is nothing to clear.
            allowClear={false}
            value={startsAt}
            onChange={changeStart}
            portalTarget={portalTarget}
            disabled={saving}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="event-end">End date</Label>
          <DateTimePicker
            id="event-end"
            label="end date"
            timeLabel="End time"
            value={endsAt}
            onChange={setEndsAt}
            portalTarget={portalTarget}
            disabled={saving}
          />
        </div>
      </div>

      {inverted && (
        <p className="text-sm text-destructive" role="alert">
          The end must not precede the start.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saving || inverted || !startsAt}
          onClick={() => void submit()}
        >
          {saving ? "Saving…" : "Save dates"}
        </Button>
      </div>
    </DialogContent>
  );
}
