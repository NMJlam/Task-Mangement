import type { Notification, NotificationKind } from "@ctp/shared";
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckSquare2,
  CircleDollarSign,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Link } from "react-router-dom";
import { LoadingLine } from "@/components/common/loading-line";
import { LogLine } from "@/components/common/log-line";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { ShellEmpty } from "@/components/common/shell-empty";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationLink } from "@/lib/notification-link";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationsPage() {
  const notifications = useNotifications();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { reload } = notifications;
  // The shell's feed polls on its own, but a reader opening the Inbox should
  // not wait for the next tick to see what arrived since.
  useEffect(() => {
    reload();
  }, [reload]);
  const items =
    notifications.state.status === "ok"
      ? notifications.state.items.filter((item) => !unreadOnly || !item.readAt)
      : [];
  const unreadCount = notifications.state.status === "ok" ? notifications.state.unreadCount : 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Inbox"
        description={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`}
        actions={
          <Button
            variant="outline"
            disabled={unreadCount === 0}
            onClick={() => void notifications.markAllRead()}
          >
            Mark All Read
          </Button>
        }
      />

      <div className="mt-6 flex gap-1 border p-1" aria-label="Notification filter">
        {[false, true].map((onlyUnread) => (
          <button
            key={String(onlyUnread)}
            type="button"
            aria-pressed={unreadOnly === onlyUnread}
            onClick={() => setUnreadOnly(onlyUnread)}
            className={cn(
              "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color]",
              unreadOnly === onlyUnread && "bg-primary text-primary-foreground",
            )}
          >
            {onlyUnread ? "Unread" : "All"}
          </button>
        ))}
      </div>

      {notifications.mutationError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {notifications.mutationError}. Try again.
        </p>
      )}
      {notifications.state.status === "loading" && (
        <LoadingLine label="Loading Notifications…" className="mt-8" />
      )}
      {notifications.state.status === "error" && (
        <LogLine tone="err" className="mt-8">
          Couldn&apos;t load notifications: {notifications.state.message}. Refresh the page to try
          again.
        </LogLine>
      )}
      {notifications.state.status === "ok" && items.length === 0 && (
        <Card className="mt-4 border-dashed shadow-none">
          <CardContent className="py-2">
            <ShellEmpty
              command="tail inbox"
              message={unreadOnly ? "You’re all caught up." : "No notifications yet."}
            />
          </CardContent>
        </Card>
      )}
      {notifications.state.status === "ok" && items.length > 0 && (
        <>
          {/* A titled pane whose rows are a key list: j/k walk the feed and
              enter opens a row's link. */}
          <Panel
            title="Notifications"
            meta={`${items.length} shown`}
            className="mt-4"
            bodyClassName="p-0"
            keys={["[j/k] move", "[enter] open"]}
          >
            <div data-key-list="inbox">
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={() => void notifications.markRead(notification)}
                />
              ))}
            </div>
          </Panel>
          {/* The feed is a capped page. Without this the oldest notification the
              reader could see was simply the 50th, with nothing saying so. */}
          {notifications.state.hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={notifications.loadingMore}
                onClick={() => void notifications.loadMore()}
              >
                {notifications.loadingMore ? "Loading…" : "Load More"}
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const Icon = notificationIcon(notification.kind);
  const unread = !notification.readAt;
  const to = notificationLink(notification);

  return (
    // A row of the feed's key list: j/k land on its link, or on Mark Read
    // when it has none. A row with neither has nothing to act on and is
    // stepped over. `tui-row` turns it inverse while it holds focus.
    <article
      data-key-item
      className={cn(
        "tui-row flex items-start gap-4 border-b p-4 last:border-0 sm:p-5",
        unread && "bg-foreground/5",
      )}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="absolute top-6 left-1.5 size-1.5 bg-accent-foreground"
        />
      )}
      <span className="tui-keep bg-accent p-2 text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6">
          {unread && <span className="sr-only">Unread: </span>}
          {/* Linked only when the row names something reachable. A notification
              whose entity has no page stays plain text rather than becoming a
              link that goes nowhere useful — see `notificationLink`.
              Reading it is also marking it read: arriving at the task is the
              acknowledgement, so leaving it bold would be a second chore. */}
          {to ? (
            <Link
              to={to}
              onClick={unread ? onRead : undefined}
              className="rounded-sm underline-offset-4 hover:underline"
            >
              {notification.body}
            </Link>
          ) : (
            notification.body
          )}
        </p>
        <time
          dateTime={notification.createdAt.toISOString()}
          className="mt-1 block text-xs text-muted-foreground"
        >
          {dateTime.format(notification.createdAt)}
        </time>
      </div>
      {unread && (
        <Button variant="ghost" size="sm" onClick={onRead}>
          Mark Read
        </Button>
      )}
    </article>
  );
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function notificationIcon(kind: NotificationKind): Icon {
  if (kind.startsWith("task_")) return CheckSquare2;
  if (kind.startsWith("event_")) return CalendarDays;
  if (kind.startsWith("expense_")) return CircleDollarSign;
  if (kind === "mention") return AtSign;
  if (kind === "invite_accepted") return UserRound;
  return Bell;
}
