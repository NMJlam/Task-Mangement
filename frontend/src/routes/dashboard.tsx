import type { EventSummary, Notification, Task } from "@ctp/shared";
import {
  Bell,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Clock3,
  Plus,
  UsersRound,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DashboardSearch } from "@/components/common/dashboard-search";
import { PageHeader } from "@/components/common/page-header";
import { PriorityDot } from "@/components/common/priority-dot";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useNotifications } from "@/hooks/use-notifications";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const headingDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const shortDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const activityDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function DashboardPage() {
  const me = useMe();
  // One reading of the clock per mount. Every window below derives from it, and
  // the events request is keyed on the bound it produces — a fresh `Date` each
  // render would re-issue that request forever.
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()), [now]);
  const tomorrow = useMemo(() => new Date(today.getTime() + DAY_MS), [today]);
  // "The next 7 days" measured from NOW, which is also what the request asks for,
  // so the widget and the read agree on one window.
  const horizon = useMemo(() => new Date(now.getTime() + 7 * DAY_MS), [now]);
  const memberId = me.status === "ok" ? me.user.id : undefined;

  // Two task reads, deliberately. The club-wide list feeds committee load and
  // ⌘K search. The personal one is a SERVER filter: "my open tasks" derived from
  // the shared capped page was the bug — a member's own task could sit past the
  // 50-row limit behind newer club work, and the Overview then claimed they had
  // none. `enabled` holds the personal read until the caller's id is known, so
  // an unresolved identity can never issue an unfiltered read instead.
  const clubTasks = useTasks();
  const myTasks = useTasks({ assignee: memberId, enabled: memberId !== undefined });
  // The week widget's window, and `asc` so the cap keeps the SOONEST events.
  // The lower bound is NOW, not midnight: with a midnight bound the first page of
  // an ascending read is the day's already-finished events, so a busy day pushes
  // the whole rest of the week past the 25-row cap — which is precisely how the
  // widget empties itself while looking complete.
  const events = useEvents({
    from: now.toISOString(),
    to: horizon.toISOString(),
    order: "asc",
  });
  const notifications = useNotifications();
  const members = useMembers();

  const clubTaskItems = clubTasks.state.status === "ok" ? clubTasks.state.items : [];
  const myTaskItems = myTasks.state.status === "ok" ? myTasks.state.items : [];
  const eventItems = events.state.status === "ok" ? events.state.items : [];
  const notificationItems = notifications.state.status === "ok" ? notifications.state.items : [];
  const memberItems = members.state.status === "ok" ? members.state.items : [];
  const eventsLoaded = events.state.status === "ok";
  // "No personal data" and "no personal data YET" are different claims, so the
  // personal widgets are gated on this rather than on an empty array.
  const personalLoaded = memberId !== undefined && myTasks.state.status === "ok";
  const personalFailed =
    me.status === "error" || (memberId !== undefined && myTasks.state.status === "error");

  const myOpenTasks = myTaskItems
    .filter((task) => task.status !== "done")
    .sort((a, b) => dueTime(a) - dueTime(b));
  const overdueCount = myOpenTasks.filter(
    (task) => task.dueAt && task.dueAt.getTime() < today.getTime(),
  ).length;
  const dueThisWeek = myOpenTasks.filter(
    (task) => task.dueAt && task.dueAt >= today && task.dueAt < horizon,
  );
  // The request already starts at now, so this only has to hold the upper end —
  // and to re-assert the lower one, since a render can outlive the instant the
  // request was issued.
  const upcomingEvents = eventItems
    .filter((event) => event.startsAt >= now && event.startsAt < horizon)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // The window read is capped at the API's page size, so the count is a floor
  // whenever the server still has a cursor to give.
  const moreEvents = events.state.status === "ok" && events.state.nextCursor !== null;
  const unreadCount = notifications.state.status === "ok" ? notifications.state.unreadCount : 0;
  const eventNames = new Map(eventItems.map((event) => [event.id, event.title]));
  const openTasksByMember = new Map<string, number>();
  clubTaskItems.forEach((task) => {
    // Every holder counts: a multi-assignee task is open work for each of them,
    // so the load bar has to grow for all of them or it under-reports.
    if (task.status !== "done") {
      for (const assigneeId of task.assigneeIds) {
        openTasksByMember.set(assigneeId, (openTasksByMember.get(assigneeId) ?? 0) + 1);
      }
    }
  });
  const committee = memberItems
    .map((member) => ({ member, count: openTasksByMember.get(member.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.member.name.localeCompare(b.member.name))
    .slice(0, 6);
  const maxLoad = Math.max(1, ...committee.map(({ count }) => count));
  const todayItems = [
    ...myOpenTasks
      .filter((task) => task.dueAt && task.dueAt >= today && task.dueAt < tomorrow)
      .map((task) => ({
        id: `task-${task.id}`,
        kind: "task" as const,
        title: task.title,
        at: task.dueAt!,
        to: "/tasks?scope=mine",
      })),
    ...eventItems
      .filter((event) => event.startsAt >= today && event.startsAt < tomorrow)
      .map((event) => ({
        id: `event-${event.id}`,
        kind: "event" as const,
        title: event.title,
        at: event.startsAt,
        to: `/events/${event.id}`,
      })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 4);

  const loading =
    me.status === "loading" ||
    clubTasks.state.status === "loading" ||
    myTasks.state.status === "loading" ||
    events.state.status === "loading" ||
    notifications.state.status === "loading" ||
    members.state.status === "loading";
  const failedSections = [
    me.status === "error" ? "your profile" : undefined,
    myTasks.state.status === "error" ? "your tasks" : undefined,
    clubTasks.state.status === "error" ? "club tasks" : undefined,
    events.state.status === "error" ? "events" : undefined,
    members.state.status === "error" ? "committee load" : undefined,
  ].filter((label): label is string => Boolean(label));

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Overview"
        description={`${headingDate.format(now)} · Your club’s work, events, and updates at a glance.`}
        actions={
          <>
            <DashboardSearch tasks={clubTaskItems} events={eventItems} members={memberItems} />
            {me.status === "ok" && me.user.tier >= 1 && (
              <Button asChild>
                <Link to="/events/new">
                  <Plus aria-hidden="true" />
                  New Event
                </Link>
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {failedSections.length > 0 && (
            <p
              className="mt-6 rounded-lg border border-destructive/30 bg-red-50 p-3 text-sm text-destructive dark:bg-red-950/40"
              role="alert"
            >
              Couldn&apos;t load {failedSections.join(", ")}. Refresh the page to try again.
            </p>
          )}

          <section
            aria-label="Overview statistics"
            className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Metric
              label="My Open Tasks"
              value={personalLoaded ? myOpenTasks.length : undefined}
              detail={
                personalLoaded
                  ? `${myOpenTasks.filter((task) => task.status === "in_progress").length} in progress`
                  : "Couldn’t load your tasks"
              }
            />
            <Metric
              label="Due Next 7 Days"
              value={personalLoaded ? dueThisWeek.length : undefined}
              detail={
                !personalLoaded
                  ? "Couldn’t load your tasks"
                  : overdueCount
                    ? `${overdueCount} overdue`
                    : "Nothing overdue"
              }
              tone={overdueCount ? "danger" : undefined}
            />
            <Metric
              label="Upcoming Events"
              value={eventsLoaded ? upcomingEvents.length : undefined}
              detail={
                !eventsLoaded
                  ? "Couldn’t load events"
                  : moreEvents
                    ? `More than ${upcomingEvents.length} in the next 7 days`
                    : "In the next 7 days"
              }
            />
            <Metric
              label="Unread Updates"
              value={unreadCount}
              detail={unreadCount ? "Review your inbox" : "You’re all caught up"}
            />
          </section>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <Card className="gap-0 py-0 shadow-none">
                <SectionHeading title="My Tasks" to="/tasks?scope=mine" action="View All" />
                <CardContent className="px-5 pb-2 sm:px-6">
                  {!personalLoaded ? (
                    <EmptyState
                      icon={CheckSquare2}
                      message={
                        personalFailed
                          ? "Your tasks are unavailable right now."
                          : "Waiting for your membership…"
                      }
                    />
                  ) : myOpenTasks.length === 0 ? (
                    <EmptyState icon={CheckSquare2} message="No open tasks are assigned to you." />
                  ) : (
                    <div className="divide-y">
                      {myOpenTasks.slice(0, 5).map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          eventName={task.eventId ? eventNames.get(task.eventId) : undefined}
                          today={today}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
                {/* The widget is capped at five, so it says how much it left out
                    instead of letting the list read as the whole of one's work. */}
                {personalLoaded && myOpenTasks.length > 5 && (
                  <div className="border-t px-5 py-2.5 sm:px-6">
                    <Link
                      to="/tasks?scope=mine"
                      className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {myOpenTasks.length - 5} more open task
                      {myOpenTasks.length - 5 === 1 ? "" : "s"}
                    </Link>
                  </div>
                )}
              </Card>

              <Card className="gap-0 py-0 shadow-none">
                <SectionHeading title="This Week’s Events" to="/events" action="All Events" />
                <CardContent className="px-5 pb-2 sm:px-6">
                  {!eventsLoaded ? (
                    <EmptyState icon={CalendarDays} message="Events are unavailable right now." />
                  ) : upcomingEvents.length === 0 ? (
                    <EmptyState
                      icon={CalendarDays}
                      message="No events are scheduled in the next 7 days."
                    />
                  ) : (
                    <div className="divide-y">
                      {upcomingEvents.slice(0, 4).map((event) => (
                        <EventRow key={event.id} event={event} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside
              aria-label="Overview details"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"
            >
              <Card className="gap-0 py-0 shadow-none">
                <SectionHeading title="Today" to="/calendar" action="Calendar" compact />
                <CardContent className="px-5 pb-5">
                  {!personalLoaded || !eventsLoaded ? (
                    <EmptyState
                      icon={Clock3}
                      message="Today’s schedule is unavailable right now."
                      compact
                    />
                  ) : todayItems.length === 0 ? (
                    <EmptyState
                      icon={Clock3}
                      message="Nothing else is scheduled for today."
                      compact
                    />
                  ) : (
                    <div className="grid gap-4">
                      {todayItems.map((item) => {
                        const Icon = item.kind === "event" ? CalendarDays : CheckSquare2;
                        return (
                          <Link
                            key={item.id}
                            to={item.to}
                            className="group flex min-w-0 gap-3 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          >
                            <span className="mt-0.5 rounded-md bg-secondary p-1.5 text-muted-foreground group-hover:text-foreground">
                              <Icon aria-hidden="true" className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium group-hover:underline">
                                {item.title}
                              </span>
                              <time
                                dateTime={item.at.toISOString()}
                                className="mt-0.5 block text-xs text-muted-foreground"
                              >
                                {time.format(item.at)}
                              </time>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="gap-0 py-0 shadow-none">
                <SectionHeading
                  title="Recent Activity"
                  to="/notifications"
                  action="Inbox"
                  compact
                />
                <CardContent className="px-5 pb-5">
                  {notificationItems.length === 0 ? (
                    <EmptyState icon={Bell} message="No recent updates." compact />
                  ) : (
                    <div className="grid gap-4">
                      {notificationItems.slice(0, 4).map((notification) => (
                        <ActivityRow key={notification.id} notification={notification} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="gap-0 py-0 shadow-none sm:col-span-2 xl:col-span-1">
                <SectionHeading title="Committee Load" to="/members" action="Members" compact />
                <CardContent className="px-5 pb-5">
                  {committee.length === 0 ? (
                    <EmptyState icon={UsersRound} message="No committee members found." compact />
                  ) : (
                    <div className="grid gap-3.5">
                      {committee.map(({ member, count }) => {
                        const name = member.name || member.email;
                        return (
                          <div key={member.id} className="flex min-w-0 items-center gap-3">
                            <UserAvatar name={name} className="size-7 text-[0.625rem]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-xs font-medium">{name}</span>
                                <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                                  {count} open
                                </span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label={`${name} open tasks`}
                                aria-valuenow={count}
                                aria-valuemin={0}
                                aria-valuemax={maxLoad}
                                aria-valuetext={`${count} open task${count === 1 ? "" : "s"}`}
                                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
                              >
                                <div
                                  className="h-full rounded-full bg-accent-foreground transition-[width]"
                                  style={{ width: `${(count / maxLoad) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  /** Absent when the read behind it failed: a failed read is not a zero. */
  value?: number;
  detail: string;
  tone?: "danger";
}) {
  return (
    <Card className="gap-2 px-5 py-4 shadow-none">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`text-3xl font-semibold tracking-[-0.04em] tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}
      >
        {value ?? "—"}
        {value === undefined && <span className="sr-only">unavailable</span>}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function SectionHeading({
  title,
  to,
  action,
  compact = false,
}: {
  title: string;
  to: string;
  action: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border-b ${compact ? "px-5 py-4" : "px-5 py-4 sm:px-6"}`}
    >
      <h2 className={compact ? "text-sm font-semibold" : "text-lg font-semibold tracking-tight"}>
        {title}
      </h2>
      <Link
        to={to}
        className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {action}
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

function TaskRow({ task, eventName, today }: { task: Task; eventName?: string; today: Date }) {
  const overdue = Boolean(task.dueAt && task.dueAt < today);
  // An event link with no loaded title is not the same as no event at all: the
  // dashboard only reads a one-week window of events, so claiming "Standalone
  // Task" here would be a fact the loaded data cannot support.
  const context = eventName ?? (task.eventId ? "Linked to an event" : "Standalone Task");

  return (
    <div className="flex min-w-0 items-center gap-3 py-3.5">
      <PriorityDot priority={task.priority} />
      <div className="min-w-0 flex-1">
        <Link
          to="/tasks?scope=mine"
          className="block truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {task.title}
        </Link>
        <p className="mt-1 truncate text-xs text-muted-foreground">{context}</p>
      </div>
      <StatusBadge status={task.status} className="hidden sm:inline-flex" />
      <div className="w-24 shrink-0 text-right">
        <time
          dateTime={task.dueAt?.toISOString()}
          className={`block text-xs tabular-nums ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {task.dueAt ? shortDate.format(task.dueAt) : "No Due Date"}
        </time>
        {/* A word, not just red text: colour alone is not a status cue for
            anyone who cannot see it. */}
        {overdue && (
          <span className="mt-0.5 block text-[0.6875rem] font-medium text-destructive">
            Overdue
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One activity item. A row is a link only where the notification's own
 * `entityType`/`entityId` name a route that exists — a task or message
 * notification has nowhere to go yet, and linking it to a list would be a
 * promise the URL cannot keep.
 */
function ActivityRow({ notification }: { notification: Notification }) {
  const to =
    notification.entityType === "event" && notification.entityId
      ? `/events/${notification.entityId}`
      : notification.entityType === "expense"
        ? "/finance"
        : undefined;
  const unread = !notification.readAt;
  const body = (
    <>
      {unread && <span className="sr-only">Unread: </span>}
      {notification.body}
    </>
  );

  return (
    <div className={cn("relative flex min-w-0 gap-3 rounded-md", unread && "bg-accent/35 p-2")}>
      <span className="mt-0.5 shrink-0 rounded-md bg-secondary p-1.5 text-muted-foreground">
        <Bell aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        {to ? (
          <Link
            to={to}
            className="line-clamp-2 rounded-sm text-sm leading-5 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {body}
          </Link>
        ) : (
          <p className="line-clamp-2 text-sm leading-5">{body}</p>
        )}
        <time
          dateTime={notification.createdAt.toISOString()}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {activityDate.format(notification.createdAt)}
        </time>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={`/events/${event.id}`}
            className="block truncate rounded-sm text-sm font-semibold hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {event.title}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <time dateTime={event.startsAt.toISOString()}>
              {shortDate.format(event.startsAt)} · {time.format(event.startsAt)}
            </time>
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
        </div>
        <StatusBadge status={event.status} />
      </div>
      <div className="mt-3">
        <EventHealthStrip
          taskCounts={event.taskCounts}
          overdueCount={event.overdueCount}
          budget={event.budget}
          subject={event.title}
        />
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  compact = false,
}: {
  icon: typeof CheckSquare2;
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center text-muted-foreground ${compact ? "py-7" : "py-10"}`}
    >
      <Icon aria-hidden="true" className="size-5" />
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      role="status"
      aria-label="Loading Overview"
    >
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-xl border bg-card" />
      ))}
      <span className="sr-only">Loading Overview…</span>
    </div>
  );
}

function dueTime(task: Task) {
  return task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
}
