import { createEventSchema } from "@ctp/shared";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateEvent } from "@/hooks/use-create-event";
import { parseLocalDate, toIsoDate } from "@/lib/dates";

export function NewEventPage() {
  const navigate = useNavigate();
  const creation = useCreateEvent();
  const [searchParams] = useSearchParams();
  // The calendar's day cells and its "New Event" action link here with the day
  // they were showing. Anything that is not a real date is ignored, so a
  // hand-edited URL opens the same empty form as the nav link does.
  const seedDate = parseLocalDate(searchParams.get("date"));
  const [validationError, setValidationError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // The start is a date and a time in one field's place: a `datetime-local`
    // cannot be seeded with a date alone, and pre-filling a midnight the reader
    // never chose would quietly write an event at 00:00.
    const startDate = String(form.get("startsAtDate") ?? "");
    const startTime = String(form.get("startsAtTime") ?? "");
    const startsAt = startDate && startTime ? new Date(`${startDate}T${startTime}`) : undefined;
    const endsAt = String(form.get("endsAt"));
    const attendance = String(form.get("attendanceEstimate"));
    const allocation = String(form.get("allocation"));
    const parsed = createEventSchema.safeParse({
      title: form.get("title"),
      description: form.get("description") || undefined,
      venue: form.get("venue") || undefined,
      startsAt,
      endsAt: endsAt ? new Date(endsAt) : undefined,
      attendanceEstimate: attendance ? Number(attendance) : undefined,
      allocationCents: allocation ? Math.round(Number(allocation) * 100) : undefined,
      minTier: Number(form.get("minTier")),
    });

    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Review the event details.");
      return;
    }
    if (parsed.data.endsAt && parsed.data.endsAt < parsed.data.startsAt) {
      setValidationError("End time must be after the start time.");
      return;
    }

    setValidationError(undefined);
    const created = await creation.createEvent(parsed.data);
    if (created) navigate(`/events/${created.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <Link
        to="/events"
        className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Events
      </Link>
      <PageHeader
        title="New Event"
        description="Create the event now. Tasks, spending, and discussion can be added afterward."
      />

      <Card className="mt-8 shadow-none">
        <CardContent>
          <form className="grid gap-6" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-2">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                name="title"
                autoComplete="off"
                placeholder="Semester Hackathon…"
                maxLength={200}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="event-start-date">Starts</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="event-start-date"
                    name="startsAtDate"
                    type="date"
                    required
                    defaultValue={seedDate ? toIsoDate(seedDate) : ""}
                    className="min-w-40 flex-1"
                  />
                  {/* The time is left empty on purpose — see `submit`. */}
                  <Input
                    id="event-start-time"
                    name="startsAtTime"
                    type="time"
                    required
                    aria-label="Start time"
                    className="w-32"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="event-end">Ends</Label>
                <Input id="event-end" name="endsAt" type="datetime-local" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="event-venue">Venue</Label>
                <Input
                  id="event-venue"
                  name="venue"
                  autoComplete="off"
                  placeholder="Great Hall…"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="event-attendance">Attendance Estimate</Label>
                <Input
                  id="event-attendance"
                  name="attendanceEstimate"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min="0"
                  step="1"
                  placeholder="150…"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="event-description">Description</Label>
              <textarea
                id="event-description"
                name="description"
                autoComplete="off"
                placeholder="What is this event for?…"
                maxLength={2000}
                rows={4}
                className="min-h-24 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="event-allocation">Budget Allocation (AUD)</Label>
                <Input
                  id="event-allocation"
                  name="allocation"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0"
                  step="0.01"
                  placeholder="0.00…"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="event-visibility">Visibility</Label>
                <select
                  id="event-visibility"
                  name="minTier"
                  defaultValue="0"
                  className="h-9 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="0">All Members</option>
                  <option value="1">Leads & Executives</option>
                  <option value="2">Executives Only</option>
                </select>
              </div>
            </div>

            {(validationError || creation.error) && (
              <p className="text-sm text-destructive" role="alert">
                {(validationError || creation.error)?.replace(/[.!?]+$/, "")}. Review the event
                details and try again.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
              <Button variant="outline" asChild>
                <Link to="/events">Cancel</Link>
              </Button>
              <Button disabled={creation.busy}>
                <CalendarPlus aria-hidden="true" />
                {creation.busy ? "Creating…" : "Create Event"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
