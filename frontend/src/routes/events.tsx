import { EventHealthStrip } from "@/components/event-health-strip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";

/** The event list (R9). ViewModel (`useEvents`) does the fetching; this stays declarative. */
export function EventsPage() {
  const events = useEvents();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Events</h1>

      {events.status === "loading" && <p className="text-muted-foreground">Loading events…</p>}
      {events.status === "error" && (
        <p className="text-destructive">Couldn&apos;t load events: {events.message}</p>
      )}
      {events.status === "ok" && events.items.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No upcoming events. Lead+ members can create one to get started.
          </CardContent>
        </Card>
      )}
      {events.status === "ok" &&
        events.items.map((event) => (
          <Card key={event.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{event.title}</span>
                <span className="text-xs font-normal text-muted-foreground uppercase">
                  {event.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {new Date(event.startsAt).toLocaleString()}
                {event.venue ? ` · ${event.venue}` : ""}
              </p>
              <EventHealthStrip
                taskCounts={event.taskCounts}
                overdueCount={event.overdueCount}
                budget={event.budget}
              />
            </CardContent>
          </Card>
        ))}
    </main>
  );
}
