import { updateEventSchema, type EventDetail, type UpdateEvent } from "@ctp/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EventDatesSave } from "@/lib/event-dates";

const selectClass =
  "h-9 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const descriptionClass =
  "min-h-24 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const AUD_TO_CENTS = 100;

/**
 * Edit an event's own fields — title, description, venue, expected attendance,
 * allocation and visibility.
 *
 * Dates are deliberately NOT here: `EventDatesDialog` owns the date picker, and
 * two dialogs writing the same two fields would be two places to get the
 * start/end rule wrong. Everything here is a single `PATCH /api/events/:id`,
 * validated against the SAME shared schema the route validates with, so a field
 * the API would reject is caught before the round trip.
 *
 * `onSave` is the caller's transport (`useEvent.updateEvent`), so this component
 * never fetches; it must not throw, and a refusal comes back as `{ ok: false }`.
 */
export function EventDetailsDialog({
  event,
  onClose,
  onSave,
  onSaved,
}: {
  /** `undefined` closes the dialog — the same contract as `EventDatesDialog`. */
  event: EventDetail | undefined;
  onClose: () => void;
  onSave: (patch: UpdateEvent) => Promise<EventDatesSave>;
  onSaved: (warnings: string[]) => void;
}) {
  return (
    <Dialog open={Boolean(event)} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed on the event so reopening starts from what is stored rather than
          from the abandoned draft. */}
      {event && (
        <EventDetailsForm
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

function EventDetailsForm({
  event,
  onClose,
  onSave,
  onSaved,
}: {
  event: EventDetail;
  onClose: () => void;
  onSave: (patch: UpdateEvent) => Promise<EventDatesSave>;
  onSaved: (warnings: string[]) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [venue, setVenue] = useState(event.venue ?? "");
  const [attendance, setAttendance] = useState(
    event.attendanceEstimate === null ? "" : String(event.attendanceEstimate),
  );
  const [allocation, setAllocation] = useState(
    event.budget.allocationCents === 0
      ? ""
      : (event.budget.allocationCents / AUD_TO_CENTS).toFixed(2),
  );
  const [minTier, setMinTier] = useState(String(event.minTier));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    // A cleared text box means "no venue/description", which is `null` on the
    // wire — sending `""` would store an empty string and leave the row with two
    // ways to say the same nothing.
    const parsed = updateEventSchema.safeParse({
      title,
      description: description.trim() === "" ? null : description,
      venue: venue.trim() === "" ? null : venue,
      attendanceEstimate: attendance.trim() === "" ? null : Number(attendance),
      allocationCents: allocation.trim() === "" ? 0 : Math.round(Number(allocation) * AUD_TO_CENTS),
      minTier: Number(minTier),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the event details.");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const result = await onSave(parsed.data);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(result.warnings);
      onClose();
    } catch {
      // A transport that threw still has to clear the busy state, or the dialog
      // sits on "Saving…" with no way forward.
      setError("Couldn't save the event. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent size="wide">
      <DialogHeader className="shrink-0">
        <DialogTitle>Edit event details</DialogTitle>
        <DialogDescription>
          Change what this event is and what it may spend. Dates are edited separately.
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void submit();
        }}
      >
        <div className="grid shrink-0 gap-2">
          <Label htmlFor="edit-event-title">Title</Label>
          <Input
            id="edit-event-title"
            value={title}
            onChange={(change) => setTitle(change.target.value)}
            autoComplete="off"
            maxLength={200}
            required
            className="h-10 text-base"
            disabled={saving}
          />
        </div>

        <div className="grid shrink-0 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-event-venue">Venue</Label>
            <Input
              id="edit-event-venue"
              value={venue}
              onChange={(change) => setVenue(change.target.value)}
              autoComplete="off"
              placeholder="Great Hall…"
              maxLength={200}
              disabled={saving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-event-attendance">Attendance Estimate</Label>
            <Input
              id="edit-event-attendance"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min="0"
              step="1"
              value={attendance}
              onChange={(change) => setAttendance(change.target.value)}
              placeholder="150…"
              disabled={saving}
            />
          </div>
        </div>

        <div className="grid shrink-0 gap-2">
          <Label htmlFor="edit-event-description">Description</Label>
          <textarea
            id="edit-event-description"
            value={description}
            onChange={(change) => setDescription(change.target.value)}
            autoComplete="off"
            placeholder="What is this event for?…"
            maxLength={2000}
            rows={4}
            className={descriptionClass}
            disabled={saving}
          />
        </div>

        <div className="grid shrink-0 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-event-allocation">Budget Allocation (AUD)</Label>
            <Input
              id="edit-event-allocation"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              step="0.01"
              value={allocation}
              onChange={(change) => setAllocation(change.target.value)}
              placeholder="0.00…"
              disabled={saving}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-event-visibility">Visibility</Label>
            <select
              id="edit-event-visibility"
              value={minTier}
              onChange={(change) => setMinTier(change.target.value)}
              className={selectClass}
              disabled={saving}
            >
              <option value="0">All Members</option>
              <option value="1">Leads &amp; Executives</option>
              <option value="2">Executives Only</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="shrink-0 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
