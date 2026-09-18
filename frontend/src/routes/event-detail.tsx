import { can, type Message, type RosterMember } from "@ctp/shared";
import { ArrowLeft, CalendarDays, CircleDollarSign, MapPin, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { EventRiskPanel } from "@/components/events/event-risk-panel";
import { TaskBoard } from "@/components/tasks/task-board";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEvent } from "@/hooks/use-event";
import { useEventProgress } from "@/hooks/use-event-progress";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useTasks } from "@/hooks/use-tasks";
import { useThreadMessages } from "@/hooks/use-threads";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "short",
});
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function EventDetailPage() {
  const { id } = useParams();
  const detail = useEvent(id);
  const { state } = detail;
  const progress = useEventProgress(id);
  const [searchParams, setSearchParams] = useSearchParams();
  // The open tab lives in the URL so a tab deep-links and Back steps through them.
  const tab = searchParams.get("tab") ?? "overview";
  // Both sit above the early returns: hook order must not change between renders.
  // Each accepts an absent id and stays idle until there is one.
  const messages = useThreadMessages(state.status === "ok" ? state.event.channelId : undefined);
  // The board reads `/api/tasks?eventId=`, not `event.tasks`: the board owns the
  // task list so a drop can move a card without refetching the whole event.
  // `enabled` keeps an absent id from ever loading the global list.
  const tasks = useTasks({ eventId: id, enabled: Boolean(id) });
  const members = useMembers();
  const memberItems = members.state.status === "ok" ? members.state.items : [];
  const me = useMe();
  const [confirming, setConfirming] = useState(false);
  // `event:cancel` is the president's alone — tier 2 also holds the VP, treasurer
  // and secretary, so a tier check cannot express this.
  const canCancel = me.status === "ok" && can(me.user.role, "event:cancel");

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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <Link
        to="/events"
        className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Events
      </Link>

      <PageHeader
        title={event.title}
        actions={
          <>
            <StatusBadge status={event.status} />
            {canCancel && event.status !== "cancelled" && (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                Cancel Event
              </Button>
            )}
          </>
        }
      />

      {confirming && (
        <Card className="mt-6 shadow-none">
          <CardHeader>
            <h2 className="font-semibold">Cancel this event?</h2>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Cancelling releases the unspent allocation and notifies everyone holding an open task.
            The event stays readable, but it cannot be un-cancelled.
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" disabled={detail.busy} onClick={() => setConfirming(false)}>
              Keep Event
            </Button>
            <Button
              disabled={detail.busy}
              onClick={() => void detail.cancelEvent().then((done) => done && setConfirming(false))}
            >
              {detail.busy ? "Cancelling…" : "Confirm Cancellation"}
            </Button>
          </CardFooter>
        </Card>
      )}
      {detail.mutationError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {detail.mutationError}. Try again.
        </p>
      )}

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
          {/* No `onUpdate`: task details stay read-only on the event tab, and
              assignment stays owned by the `/tasks` page. */}
          {tasks.mutationError && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {tasks.mutationError}. Try again.
            </p>
          )}
          {tasks.state.status === "loading" && (
            <p className="text-sm text-muted-foreground" role="status">
              Loading Tasks…
            </p>
          )}
          {tasks.state.status === "error" && (
            <p className="text-sm text-destructive" role="alert">
              Couldn&apos;t load tasks: {tasks.state.message}. Refresh the page to try again.
            </p>
          )}
          {tasks.state.status === "ok" && (
            <TaskBoard
              tasks={tasks.state.items}
              members={memberItems}
              busyId={tasks.busy}
              error={tasks.mutationError}
              emptyMessage="No tasks are linked to this event yet."
              onStatusChange={(task, status) => void tasks.changeStatus(task, status)}
            />
          )}
        </TabsContent>

        <TabsContent value="thread">
          <Card className="shadow-none">
            <CardHeader>
              <h2 className="text-lg font-semibold tracking-tight">Event Thread</h2>
              <p className="text-sm text-muted-foreground">
                Discussion attached to this event. Posting lives on Messages.
              </p>
            </CardHeader>
            <CardContent>
              {!event.channelId ? (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  This event has no thread yet.
                </p>
              ) : messages.state.status === "loading" ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading Thread…
                </p>
              ) : messages.state.status === "error" ? (
                <p className="text-sm text-destructive" role="alert">
                  Couldn&apos;t load the thread: {messages.state.message}. Refresh the page to try
                  again.
                </p>
              ) : messages.state.status === "ok" && messages.state.items.length > 0 ? (
                <ol className="grid gap-4">
                  {[...messages.state.items].reverse().map((item) => (
                    <li key={item.id}>
                      <ThreadMessage message={item} members={memberItems} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No messages in this thread yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TODO(R11): file upload is Deferred — no storage endpoint exists yet. */}
        <TabsContent value="files">
          <Card className="border-dashed shadow-none">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              File attachments are not built yet. Documents and images will attach here once upload
              ships.
            </CardContent>
          </Card>
        </TabsContent>

        {/* TODO(R4): RSVP tracker — no schema, table or endpoint exists yet. */}
        <TabsContent value="rsvps">
          <Card className="border-dashed shadow-none">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              RSVP tracking is not built yet. Attendance responses will appear here once the
              endpoint ships.
            </CardContent>
          </Card>
        </TabsContent>
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

/**
 * `messageSchema.author` is a member id, not a name — the roster resolves it,
 * exactly as `MessageRow` does on the Messages page.
 */
function ThreadMessage({ message, members }: { message: Message; members: RosterMember[] }) {
  const author = members.find((member) => member.id === message.author);
  const name = message.aiRunId ? "MAC Assistant" : author?.name || author?.email || "Former Member";

  return (
    <article className="flex items-start gap-3 rounded-lg border p-4">
      <UserAvatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">{name}</h3>
          <time
            dateTime={message.createdAt.toISOString()}
            className="text-xs text-muted-foreground"
          >
            {dateTime.format(message.createdAt)}
          </time>
        </div>
        <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </div>
    </article>
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
