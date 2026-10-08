import type { AuthUser } from "@ctp/shared";
import { Link, useLocation } from "react-router-dom";
import { NOTIFICATION_POLL_MS, useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { promptPath } from "@/lib/prompt-path";
import { cn } from "@/lib/utils";

/** Reads this far apart mean the feed has fallen behind, not merely ticked. */
const LAG_MS = Math.max(3 * NOTIFICATION_POLL_MS, 5_000);

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * The shell prompt and modeline, pinned to the bottom of every signed-in page:
 *
 *   jordan.lee@mac:~/events/0000a1b2/thread$            ● 3 unread · synced
 *
 * The sync state holds still while the feed keeps up: "synced", not a count of
 * seconds. Text that rewrites itself every second, with no way to pause it, is
 * moving content under WCAG 2.2.2. Only once reads fall behind does it change,
 * once, to the time of the last good read. Not a live region either: the
 * unread count is a link to the Inbox, and the sidebar badge announces it.
 */
export function StatusLine({ member }: { member: AuthUser }) {
  const location = useLocation();
  const notifications = useNotifications();
  const now = useNow();
  const unread = notifications.state.status === "ok" ? notifications.state.unreadCount : 0;
  const user = member.email.split("@")[0];

  return (
    <footer
      aria-label="Status line"
      className="sticky bottom-0 z-30 flex h-7 items-center gap-4 border-t bg-card px-4 font-mono text-xs"
    >
      <p className="min-w-0 truncate">
        <span className="hidden text-muted-foreground sm:inline">{user}@mac:</span>
        <span>{promptPath(location.pathname, location.search)}</span>
        <span aria-hidden="true" className="text-ring">
          $
        </span>
      </p>
      <p className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
        <Link to="/notifications" className="hover:text-foreground">
          <span aria-hidden="true" className={cn(unread > 0 && "text-ring")}>
            ●{" "}
          </span>
          {unread} unread
        </Link>
        <span aria-hidden="true">·</span>
        {notifications.stale ? (
          <span className="text-danger">offline · retrying</span>
        ) : notifications.syncedAt ? (
          now.getTime() - notifications.syncedAt.getTime() > LAG_MS ? (
            <span>last sync {clock.format(notifications.syncedAt)}</span>
          ) : (
            <span>synced</span>
          )
        ) : (
          <span>connecting…</span>
        )}
      </p>
    </footer>
  );
}
