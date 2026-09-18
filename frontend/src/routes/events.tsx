import { CalendarDays, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { CreateEventForm } from "@/components/events/create-event-form";
import { EventFilters, type TimeFilter } from "@/components/events/event-filters";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";
import { useMe } from "@/hooks/use-me";

const eventDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The event list (R9). ViewModel (`useEvents`) does the fetching; this stays declarative. */
export function EventsPage() {
  const [time, setTime] = useState<TimeFilter>("upcoming");
  const [status, setStatus] = useState("");
  // One timestamp per mount — a fresh `new Date()` each render would refetch forever.
  const now = useMemo(() => new Date().toISOString(), []);
  const query = useMemo(
    () => ({
      status: status || undefined,
      from: time === "upcoming" ? now : undefined,
      to: time === "past" ? now : undefined,
    }),
    [status, time, now],
  );
  const events = useEvents(query);
  const { state } = events;
  // `POST /api/events` is tier 1 — hiding the form keeps a guaranteed 403 off screen.
  const me = useMe();
  const canCreate = me.status === "ok" && me.user.tier >= 1;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Events"
        description="Plan upcoming club events and keep delivery, deadlines, and spending visible."
      />

      {canCreate && <CreateEventForm onSubmit={events.createEvent} busy={events.busy} />}

      <EventFilters time={time} status={status} onTimeChange={setTime} onStatusChange={setStatus} />

      {state.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Events…
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load events: {state.message}. Refresh the page to try again.
        </p>
      )}
      {state.status === "ok" && state.items.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No upcoming events. Lead+ members can create one to get started.
          </CardContent>
        </Card>
      )}
      {state.status === "ok" && state.items.length > 0 && (
        <section aria-label="Event list" className="mt-8 grid gap-3">
          {state.items.map((event) => (
            <Card
              key={event.id}
              className="relative gap-0 py-0 shadow-none transition-[border-color,box-shadow] focus-within:border-input focus-within:shadow-sm hover:border-input hover:shadow-sm"
            >
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight">
                      {/*
                        The link stretches over the whole card via `after:`, so any
                        part of the card is a click target while the accessible name
                        stays the title. Wrapping the card in an anchor instead would
                        read the venue, status and progress out as link text.
                      */}
                      <Link
                        to={`/events/${event.id}`}
                        className="rounded-sm after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {event.title}
                      </Link>
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays aria-hidden="true" className="size-3.5" />
                        <time dateTime={new Date(event.startsAt).toISOString()}>
                          {eventDate.format(new Date(event.startsAt))}
                        </time>
                        {event.endsAt && (
                          <span>
                            –{" "}
                            <time dateTime={new Date(event.endsAt).toISOString()}>
                              {eventDate.format(new Date(event.endsAt))}
                            </time>
                          </span>
                        )}
                      </span>
                      {event.venue && (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="truncate">{event.venue}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={event.status} />
                </div>
                <div className="mt-5 border-t pt-4">
                  <EventHealthStrip
                    taskCounts={event.taskCounts}
                    overdueCount={event.overdueCount}
                    budget={event.budget}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {state.status === "ok" && state.nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            disabled={events.loadingMore}
            onClick={() => void events.loadMore()}
          >
            {events.loadingMore ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}
      {events.mutationError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {events.mutationError}. Try again.
        </p>
      )}
    </main>
  );
}
