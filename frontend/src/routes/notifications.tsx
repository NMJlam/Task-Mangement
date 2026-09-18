import type { Notification, NotificationKind } from "@ctp/shared";
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckSquare2,
  CircleDollarSign,
  UserRound,
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationsPage() {
  const notifications = useNotifications();
  const [unreadOnly, setUnreadOnly] = useState(false);
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
            disabled={unreadCount === 0 || Boolean(notifications.busy)}
            onClick={() => void notifications.markAllRead()}
          >
            {notifications.busy === "all" ? "Marking…" : "Mark All Read"}
          </Button>
        }
      />

      <div className="mt-6 flex gap-1 rounded-lg bg-secondary p-1" aria-label="Notification filter">
        {[false, true].map((onlyUnread) => (
          <button
            key={String(onlyUnread)}
            type="button"
            aria-pressed={unreadOnly === onlyUnread}
            onClick={() => setUnreadOnly(onlyUnread)}
            className={cn(
              "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              unreadOnly === onlyUnread && "bg-card text-foreground shadow-sm",
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
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Notifications…
        </p>
      )}
      {notifications.state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load notifications: {notifications.state.message}. Refresh the page to try
          again.
        </p>
      )}
      {notifications.state.status === "ok" && items.length === 0 && (
        <Card className="mt-4 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {unreadOnly ? "You’re all caught up." : "No notifications yet."}
          </CardContent>
        </Card>
      )}
      {notifications.state.status === "ok" && items.length > 0 && (
        <section
          aria-label="Notifications"
          className="mt-4 overflow-hidden rounded-xl border bg-card"
        >
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              busy={notifications.busy === notification.id}
              onRead={() => void notifications.markRead(notification)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function NotificationRow({
  notification,
  busy,
  onRead,
}: {
  notification: Notification;
  busy: boolean;
  onRead: () => void;
}) {
  const Icon = notificationIcon(notification.kind);
  const unread = !notification.readAt;

  return (
    <article
      className={cn(
        "relative flex items-start gap-4 border-b p-4 last:border-0 sm:p-5",
        unread && "bg-accent/35",
      )}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="absolute top-6 left-1.5 size-1.5 rounded-full bg-accent-foreground"
        />
      )}
      <span className="rounded-lg bg-secondary p-2 text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6">
          {unread && <span className="sr-only">Unread: </span>}
          {notification.body}
        </p>
        <time
          dateTime={notification.createdAt.toISOString()}
          className="mt-1 block text-xs text-muted-foreground"
        >
          {dateTime.format(notification.createdAt)}
        </time>
      </div>
      {unread && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRead}>
          {busy ? "Marking…" : "Mark Read"}
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
