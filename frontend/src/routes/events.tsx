import { eventStatusSchema } from "@ctp/shared";
import { CalendarDays, MapPin, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { EventFilters, eventsFiltered, type TimeFilter } from "@/components/events/event-filters";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";
import { useMe } from "@/hooks/use-me";

const eventDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type Filters = { time: TimeFilter; status: string; mine: boolean };

const DEFAULT_FILTERS: Filters = { time: "upcoming", status: "", mine: false };

/**
 * The filters a URL carries. Defaults are omitted, so a bare `/events` is the
 * canonical upcoming list, and an unrecognised value falls back to its default
 * rather than trapping the reader in a filter with no control for it.
 */
function readFilters(params: URLSearchParams): Filters {
  const time = params.get("time");
  const status = eventStatusSchema.safeParse(params.get("status"));
  return {
    time: time === "past" || time === "all" ? time : "upcoming",
    status: status.success ? status.data : "",
    mine: params.get("owner") === "mine",
  };
}

/** The active filters in the reader's own words, for the empty state. */
function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.mine) parts.push("owned by you");
  if (filters.status) parts.push(filters.status);
  if (filters.time === "past") parts.push("in the past");
  if (filters.time === "all") parts.push("past and upcoming");
  return parts.join(", ");
}

/** The event list (R9). ViewModel (`useEvents`) does the fetching; this stays declarative. */
export function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  // One timestamp per mount — a fresh `new Date()` each render would refetch forever.
  const now = useMemo(() => new Date().toISOString(), []);
  const me = useMe();
  // `/events/new` is guarded at minTier 1 — hiding the link keeps a guaranteed
  // bounce off screen.
  const canCreate = me.status === "ok" && me.user.tier >= 1;
  const identityReady = me.status === "ok";
  const query = useMemo(
    () => ({
      status: filters.status || undefined,
      from: filters.time === "upcoming" ? now : undefined,
      to: filters.time === "past" ? now : undefined,
      ownerId: filters.mine && identityReady ? me.user.id : undefined,
      // Soonest first is a property of the READ, not of the rendering: the
      // default order is newest-first, so a capped page of upcoming events would
      // hold the furthest-future ones and hide what is happening next.
      order: filters.time === "upcoming" ? ("asc" as const) : undefined,
    }),
    [filters.status, filters.time, filters.mine, now, identityReady, me],
  );
  // "My Events" cannot be answered before `/api/me` does, and the unfiltered
  // list would be indistinguishable from the filtered one.
  const events = useEvents(query, { enabled: !filters.mine || identityReady });
  const { state } = events;

  const filtered = eventsFiltered(filters.time, filters.status, filters.mine);

  function writeFilters(next: Filters) {
    const params = new URLSearchParams();
    if (next.time !== DEFAULT_FILTERS.time) params.set("time", next.time);
    if (next.status) params.set("status", next.status);
    if (next.mine) params.set("owner", "mine");
    setSearchParams(params);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Events"
        description="Plan upcoming club events and keep delivery, deadlines, and spending visible."
        actions={
          canCreate && (
            <Button asChild>
              <Link to="/events/new">
                <Plus aria-hidden="true" />
                New Event
              </Link>
            </Button>
          )
        }
      />

      <EventFilters
        time={filters.time}
        status={filters.status}
        mine={filters.mine}
        onTimeChange={(time) => writeFilters({ ...filters, time })}
        onStatusChange={(status) => writeFilters({ ...filters, status })}
        onOwnerChange={(mine) => writeFilters({ ...filters, mine })}
        onClear={() => writeFilters(DEFAULT_FILTERS)}
      />

      {filters.mine && !identityReady && me.status !== "loading" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load your membership, so your events can&apos;t be listed.{" "}
          <Link to="/events" className="underline">
            Show all events
          </Link>
          .
        </p>
      )}
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
      {state.status === "ok" &&
        // Filtering swaps the list with no other cue, so the count is announced.
        // Only rendered while a filter is active, which keeps a bare "12 events"
        // out of the tab order on an unfiltered list. The Load More button below
        // is visible proof that this page is not the whole answer, so the
        // sentence says so too instead of reading as a total.
        filtered && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            {state.items.length === 1 ? "1 event matches." : `${state.items.length} events match.`}
            {state.nextCursor ? " Load More for the rest." : ""}
          </p>
        )}
      {state.status === "ok" && state.items.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {filtered
              ? `No events match these filters: ${describeFilters(filters)}. Use Clear Filters to widen the list.`
              : "No upcoming events. Lead+ members can create one to get started."}
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
                    subject={event.title}
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
