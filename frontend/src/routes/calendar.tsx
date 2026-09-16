import { Card, CardContent } from "@/components/ui/card";
import { useCalendar } from "@/hooks/use-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar agenda (R9): events and tasks due in the next 30 days, one merged list. */
export function CalendarPage() {
  const from = new Date();
  const to = new Date(from.getTime() + 30 * DAY_MS);
  const calendar = useCalendar(from, to);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
      <p className="text-sm text-muted-foreground">
        {from.toLocaleDateString()} – {to.toLocaleDateString()}
      </p>

      {calendar.status === "loading" && (
        <p className="text-muted-foreground">Loading the calendar…</p>
      )}
      {calendar.status === "error" && (
        <p className="text-destructive">Couldn&apos;t load the calendar: {calendar.message}</p>
      )}
      {calendar.status === "ok" && calendar.items.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nothing on the calendar in the next 30 days.
          </CardContent>
        </Card>
      )}
      {calendar.status === "ok" &&
        calendar.items.map((item) => (
          <Card key={`${item.kind}-${item.id}`}>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {item.kind === "event"
                    ? new Date(item.startsAt).toLocaleString()
                    : item.dueAt
                      ? new Date(item.dueAt).toLocaleString()
                      : "No due date"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground uppercase">{item.kind}</span>
            </CardContent>
          </Card>
        ))}
    </main>
  );
}
