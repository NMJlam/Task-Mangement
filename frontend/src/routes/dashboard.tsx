import type { EventSummary, Notification, Task } from "@ctp/shared";
import { Bell, CalendarDays, CheckSquare2, ChevronRight, Plus } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BriefingCard } from "@/components/ai/briefing-card";
import { DashboardSearch } from "@/components/common/dashboard-search";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { PriorityDot } from "@/components/common/priority-dot";
import { ShellEmpty } from "@/components/common/shell-empty";
import { StatusBadge } from "@/components/common/status-badge";
import { TextMeter } from "@/components/common/text-meter";
import { UserAvatar } from "@/components/common/user-avatar";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
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

      {/* The briefing leads the page (spec M13) and loads on its own, so it is
          outside the dashboard's skeleton: it shows the moment it is ready. */}
      <BriefingCard className="mt-6" />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {failedSections.length > 0 && (
            <p
              className="mt-6 border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
              role="alert"
            >
              Couldn&apos;t load {failedSections.join(", ")}. Refresh the page to try again.
            </p>
          )}

          {/* One panel, ruled into cells like a hardware readout: the 1px
              gaps over the border colour are the grid lines. */}
          <Panel title="At a glance" className="mt-6" bodyClassName="px-0 pt-1 pb-0">
            <dl className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
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
            </dl>
          </Panel>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <Panel
                title="My Tasks"
                action={<PanelLink to="/tasks?scope=mine">View All</PanelLink>}
                bodyClassName="px-5 pb-2 sm:px-6 pt-2"
              >
                {!personalLoaded ? (
                  <ShellEmpty
                    command="ls tasks/"
                    message={
                      personalFailed
                        ? "Your tasks are unavailable right now."
                        : "Waiting for your membership…"
                    }
                  />
                ) : myOpenTasks.length === 0 ? (
                  <ShellEmpty command="ls tasks/" message="No open tasks are assigned to you." />
                ) : (
                  <div data-key-list="overview" className="divide-y">
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
                {/* The widget is capped at five, so it says how much it left out
                    instead of letting the list read as the whole of one's work. */}
                {personalLoaded && myOpenTasks.length > 5 && (
                  <div className="mt-1 border-t pt-2.5">
                    <Link
                      to="/tasks?scope=mine"
                      className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {myOpenTasks.length - 5} more open task
                      {myOpenTasks.length - 5 === 1 ? "" : "s"}
                    </Link>
                  </div>
                )}
              </Panel>

              <Panel
                title="This Week’s Events"
                action={<PanelLink to="/events">All Events</PanelLink>}
                bodyClassName="px-5 pb-2 sm:px-6 pt-2"
              >
                {!eventsLoaded ? (
                  <ShellEmpty command="ls events/" message="Events are unavailable right now." />
                ) : upcomingEvents.length === 0 ? (
                  <ShellEmpty
                    command="ls events/"
                    message="No events are scheduled in the next 7 days."
                  />
                ) : (
                  <div data-key-list="overview" className="divide-y">
                    {upcomingEvents.slice(0, 4).map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <aside
              aria-label="Overview details"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"
            >
              <Panel
                title="Today"
                action={<PanelLink to="/calendar">Calendar</PanelLink>}
                bodyClassName="px-5 pb-5 pt-2"
              >
                {!personalLoaded || !eventsLoaded ? (
                  <ShellEmpty
                    command="cal today"
                    message="Today’s schedule is unavailable right now."
                    compact
                  />
                ) : todayItems.length === 0 ? (
                  <ShellEmpty
                    command="cal today"
                    message="Nothing else is scheduled for today."
                    compact
                  />
                ) : (
                  <div data-key-list="overview" className="grid gap-4">
                    {todayItems.map((item) => {
                      const Icon = item.kind === "event" ? CalendarDays : CheckSquare2;
                      return (
                        <Link
                          key={item.id}
                          to={item.to}
                          className="group flex min-w-0 gap-3 rounded-md"
                        >
                          <span className="mt-0.5 bg-accent p-1.5 text-muted-foreground group-hover:text-foreground">
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
              </Panel>

              <Panel
                title="Recent Activity"
                action={<PanelLink to="/notifications">Inbox</PanelLink>}
                bodyClassName="px-5 pb-5 pt-2"
              >
                {notificationItems.length === 0 ? (
                  <ShellEmpty command="tail inbox" message="No recent updates." compact />
                ) : (
                  <div data-key-list="overview" className="grid gap-4">
                    {notificationItems.slice(0, 4).map((notification) => (
                      <ActivityRow key={notification.id} notification={notification} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel
                title="Committee Load"
                action={<PanelLink to="/members">Members</PanelLink>}
                className="sm:col-span-2 xl:col-span-1"
                bodyClassName="px-5 pb-5 pt-2"
              >
                {committee.length === 0 ? (
                  <ShellEmpty command="ls members/" message="No committee members found." compact />
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
                            <TextMeter
                              value={count}
                              max={maxLoad}
                              cells={12}
                              label={`${name} open tasks`}
                              valueText={`${count} open task${count === 1 ? "" : "s"}`}
                              className="mt-1.5 text-xs"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * One cell of the At a glance grid: a tiny uppercase label over the figure,
 * as a hardware readout labels its dials.
 */
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
    <div className="bg-card px-4 py-3">
      <dt className="text-[0.6875rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-3xl font-semibold tracking-[-0.04em] tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value ?? "—"}
        {value === undefined && <span className="sr-only">unavailable</span>}
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd>
    </div>
  );
}

/** The link a panel carries in its border: "View All ›". */
function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
    >
      {children}
      <ChevronRight aria-hidden="true" className="size-3.5" />
    </Link>
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
          className="block truncate rounded-sm text-sm font-medium hover:underline"
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
    <div className={cn("relative flex min-w-0 gap-3 rounded-md", unread && "bg-foreground/5 p-2")}>
      <span className="mt-0.5 shrink-0 bg-accent p-1.5 text-muted-foreground">
        <Bell aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        {to ? (
          <Link to={to} className="line-clamp-2 rounded-sm text-sm leading-5 hover:underline">
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
            className="block truncate rounded-sm text-sm font-semibold hover:underline"
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
