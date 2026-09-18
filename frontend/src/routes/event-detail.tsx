import { ArrowLeft, CalendarDays, CircleDollarSign, MapPin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EventHealthStrip } from "@/components/event-health-strip";
import { EventRiskPanel } from "@/components/event-risk-panel";
import { EventTaskBoard } from "@/components/event-task-board";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEvent } from "@/hooks/use-event";
import { useEventProgress } from "@/hooks/use-event-progress";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "short",
});
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function EventDetailPage() {
  const { id } = useParams();
  const { state } = useEvent(id);
  const progress = useEventProgress(id);
  const [searchParams, setSearchParams] = useSearchParams();
  // The open tab lives in the URL so a tab deep-links and Back steps through them.
  const tab = searchParams.get("tab") ?? "overview";

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params);
  }

  if (state.status === "loading") {
    return <PageState role="status">Loading Event…</PageState>;
  }
  if (state.status === "not_found") {
    return <PageState role="alert">This event could not be found.</PageState>;
  }
  if (state.status === "error") {
    return (
      <PageState role="alert">
        Couldn&apos;t load the event: {state.message}. Refresh the page to try again.
      </PageState>
    );
  }

  const { event } = state;
  const tasks = event.tasks ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <Link
        to="/events"
        className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Events
      </Link>

      <PageHeader title={event.title} actions={<StatusBadge status={event.status} />} />

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays aria-hidden="true" className="size-4" />
          <time dateTime={event.startsAt.toISOString()}>{dateTime.format(event.startsAt)}</time>
        </span>
        {event.venue && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-4" />
            {event.venue}
          </span>
        )}
        {event.owner?.name && (
          <span className="inline-flex items-center gap-1.5">
            <UserRound aria-hidden="true" className="size-4" />
            {event.owner.name}
          </span>
        )}
      </div>

      <Tabs value={tab} onValueChange={selectTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="thread">Thread</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="rsvps">RSVPs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_0.6fr]">
            <Card className="shadow-none">
              <CardHeader>
                <h2 className="text-lg font-semibold tracking-tight">About</h2>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {event.description || "No event description has been added yet."}
                </p>
                {event.attendanceEstimate !== null && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Expected attendance:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {event.attendanceEstimate}
                    </span>
                  </p>
                )}
                <div className="mt-6 border-t pt-5">
                  <h3 className="mb-3 text-sm font-medium">Delivery Progress</h3>
                  <EventHealthStrip
                    taskCounts={event.taskCounts}
                    overdueCount={event.overdueCount}
                    budget={event.budget}
                  />
                </div>
                <div className="mt-6 border-t pt-5">
                  {progress.status === "ok" ? (
                    <EventRiskPanel progress={progress.progress} />
                  ) : progress.status === "loading" ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      Loading Risk…
                    </p>
                  ) : (
                    // Deliberately soft: a missing verdict must not read as though
                    // the event itself failed to load.
                    <p className="text-sm text-muted-foreground">
                      The risk verdict is unavailable right now.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight">Event Budget</h2>
                  <CircleDollarSign aria-hidden="true" className="size-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <BudgetRow label="Allocated" cents={event.budget.allocationCents} />
                <BudgetRow label="Committed" cents={event.budget.committedCents} />
                <BudgetRow label="Paid" cents={event.budget.spentCents} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <EventTaskBoard tasks={tasks} />
        </TabsContent>

        <TabsContent value="thread" />
        <TabsContent value="files" />
        <TabsContent value="rsvps" />
      </Tabs>
    </main>
  );
}

function PageState({ children, role }: { children: ReactNode; role: "status" | "alert" }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <p
        className={cn("text-sm text-muted-foreground", role === "alert" && "text-destructive")}
        role={role}
      >
        {children}
      </p>
    </main>
  );
}

function BudgetRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{money.format(cents / 100)}</span>
    </div>
  );
}
