import { CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { EventHealthStrip } from "@/components/event-health-strip";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";

const eventDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The event list (R9). ViewModel (`useEvents`) does the fetching; this stays declarative. */
export function EventsPage() {
  const events = useEvents();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Events"
        description="Plan upcoming club events and keep delivery, deadlines, and spending visible."
      />

      {events.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Events…
        </p>
      )}
      {events.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load events: {events.message}. Refresh the page to try again.
        </p>
      )}
      {events.status === "ok" && events.items.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No upcoming events. Lead+ members can create one to get started.
          </CardContent>
        </Card>
      )}
      {events.status === "ok" && events.items.length > 0 && (
        <section aria-label="Event list" className="mt-8 grid gap-3">
          {events.items.map((event) => (
            <Card
              key={event.id}
              className="gap-0 py-0 shadow-none transition-[border-color,box-shadow] hover:border-input hover:shadow-sm"
            >
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight">
                      <Link
                        to={`/events/${event.id}`}
                        className="rounded-sm hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
    </main>
  );
}
