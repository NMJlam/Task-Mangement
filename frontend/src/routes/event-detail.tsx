import type { Task, TaskStatus } from "@ctp/shared";
import { ArrowLeft, CalendarDays, CircleDollarSign, MapPin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { EventHealthStrip } from "@/components/event-health-strip";
import { PageHeader } from "@/components/page-header";
import { PriorityDot } from "@/components/priority-dot";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useEvent } from "@/hooks/use-event";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "short",
});
const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export function EventDetailPage() {
  const { id } = useParams();
  const state = useEvent(id);

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

      <div className="mt-8 grid items-start gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">About</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              {event.description || "No event description has been added yet."}
            </p>
            <div className="mt-6 border-t pt-5">
              <h3 className="mb-3 text-sm font-medium">Delivery Progress</h3>
              <EventHealthStrip
                taskCounts={event.taskCounts}
                overdueCount={event.overdueCount}
                budget={event.budget}
              />
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

      <section aria-labelledby="event-tasks-heading" className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="event-tasks-heading" className="text-xl font-semibold tracking-tight">
            Tasks
          </h2>
          <p className="text-sm text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </p>
        </div>
        {tasks.length === 0 ? (
          <Card className="mt-3 border-dashed shadow-none">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No tasks are linked to this event yet.
            </CardContent>
          </Card>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {columns.map((column) => {
              const items = tasks.filter((task) => task.status === column.status);
              return (
                <section key={column.status} aria-labelledby={`${column.status}-heading`}>
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h3 id={`${column.status}-heading`} className="text-sm font-semibold">
                      {column.label}
                    </h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {items.length}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {items.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                    {items.length === 0 && (
                      <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                        No tasks
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
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

function TaskCard({ task }: { task: Task }) {
  return (
    <Card className="gap-3 py-4 shadow-none">
      <CardContent className="px-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5">
            <PriorityDot priority={task.priority} />
          </span>
          <h4 className="text-sm leading-5 font-medium">{task.title}</h4>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {task.dueAt ? `Due ${shortDate.format(task.dueAt)}` : "No due date"}
        </p>
      </CardContent>
    </Card>
  );
}
