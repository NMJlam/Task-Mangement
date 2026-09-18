import { CalendarDays, CheckSquare2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { useCalendar } from "@/hooks/use-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateRange = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const day = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const month = new Intl.DateTimeFormat(undefined, { month: "short" });
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The calendar agenda (R9): events and tasks due in the next 30 days, one merged list. */
export function CalendarPage() {
  const [from] = useState(() => new Date());
  const to = new Date(from.getTime() + 30 * DAY_MS);
  const calendar = useCalendar(from, to);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Calendar"
        description={`${dateRange.format(from)} – ${dateRange.format(to)} · Events and task deadlines for the next 30 days.`}
      />

      {calendar.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading the Calendar…
        </p>
      )}
      {calendar.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load the calendar: {calendar.message}. Refresh the page to try again.
        </p>
      )}
      {calendar.status === "ok" && calendar.items.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing on the calendar in the next 30 days.
          </CardContent>
        </Card>
      )}
      {calendar.status === "ok" && calendar.items.length > 0 && (
        <section aria-label="Calendar agenda" className="mt-8 grid gap-3">
          {calendar.items.map((item) => {
            const when = item.kind === "event" ? item.startsAt : item.dueAt;
            const Icon = item.kind === "event" ? CalendarDays : CheckSquare2;

            return (
              <Card key={`${item.kind}-${item.id}`} className="gap-0 py-0 shadow-none">
                <CardContent className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-4 p-4 sm:gap-5 sm:p-5">
                  <time
                    dateTime={when ? new Date(when).toISOString() : undefined}
                    className="flex size-14 flex-col items-center justify-center rounded-lg bg-secondary text-center"
                  >
                    <span className="text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {when ? month.format(new Date(when)) : "TBD"}
                    </span>
                    <span className="text-xl leading-none font-semibold tabular-nums">
                      {when ? day.format(new Date(when)) : "—"}
                    </span>
                  </time>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{item.title}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      {when ? dateTime.format(new Date(when)) : "No due date"}
                    </p>
                  </div>
                  {item.kind === "event" ? (
                    <StatusBadge status={item.status} className="hidden sm:inline-flex" />
                  ) : (
                    <span className="hidden rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground sm:inline-flex">
                      Task
                    </span>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </main>
  );
}
