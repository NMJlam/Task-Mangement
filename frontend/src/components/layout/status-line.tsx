import type { AuthUser } from "@ctp/shared";
import { Link, useLocation } from "react-router-dom";
import { useNotifications } from "@/hooks/use-notifications";
import { useNow } from "@/hooks/use-now";
import { promptPath, syncAge } from "@/lib/prompt-path";
import { cn } from "@/lib/utils";

/**
 * The shell prompt and modeline, pinned to the bottom of every signed-in page:
 *
 *   jordan.lee@mac:~/events/0000a1b2/thread$        ● 3 unread · synced 2s ago
 *
 * Deliberately NOT a live region: the age ticks every second, and a status line
 * that announced itself each tick would drown everything else. The unread count
 * is a link to the Inbox; the sidebar badge already announces it in the nav.
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
          <span>synced {syncAge(now.getTime() - notifications.syncedAt.getTime())}</span>
        ) : (
          <span>connecting…</span>
        )}
      </p>
    </footer>
  );
}
