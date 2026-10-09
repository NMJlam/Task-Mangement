import type { AuthUser } from "@ctp/shared";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckSquare2,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import { AsciiWordmark } from "@/components/common/ascii-wordmark";
import { UserAvatar } from "@/components/common/user-avatar";
import { StatusLine } from "@/components/layout/status-line";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const navigation: { to: string; label: string; icon: Icon }[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/events", label: "Events", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: CheckSquare2 },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/finance", label: "Finance", icon: Landmark },
  { to: "/notifications", label: "Inbox", icon: Bell },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/ai", label: "AI Breakdown", icon: Bot },
  { to: "/members", label: "Members", icon: UsersRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Two digits and a cap, so a long-unread inbox cannot widen the sidebar. */
function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function AppShell({
  member,
  signOut,
  children,
}: {
  member: AuthUser;
  signOut: () => Promise<unknown>;
  children: ReactNode;
}) {
  // The feed the Inbox page also reads — one instance, so marking a row read
  // there drops this count in the same render (see `useNotifications`).
  const notifications = useNotifications();
  const unread = notifications.state.status === "ok" ? notifications.state.unreadCount : 0;

  return (
    <>
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0"
      >
        Skip to Content
      </a>
      <div className="min-h-svh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-svh flex-col border-r bg-card px-3 py-4 lg:flex">
          <Brand />
          <nav aria-label="Main navigation" className="mt-7 grid gap-1">
            {navigation.map((item) => (
              <NavigationLink key={item.to} {...item} unread={unread} />
            ))}
          </nav>
          <div className="mt-auto border-t pt-4">
            <div className="flex min-w-0 items-center gap-3 px-2">
              <UserAvatar name={member.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.email}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground capitalize">
                  {member.role.replaceAll("_", " ")}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="mt-3 w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </aside>

        {/* A full-height column, so the status line sits at the bottom of a
            short page and sticks there on a long one. */}
        <div className="flex min-h-svh min-w-0 flex-col">
          {/* Opaque, not translucent-with-blur: a terminal does not frost what
              is behind its chrome. */}
          <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background px-4 py-3 lg:hidden">
            <Brand compact />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden="true" />
            </Button>
          </header>
          <nav
            aria-label="Mobile navigation"
            className="sticky top-14 z-30 flex overflow-x-auto border-b bg-background lg:hidden"
          >
            {navigation.map((item) => (
              <NavigationLink key={item.to} {...item} unread={unread} compact />
            ))}
          </nav>
          <div
            id="main-content"
            tabIndex={-1}
            // No focus outline here on purpose: this is a skip-link target, and
            // an outline drawn around the whole main region reads as a bug. The
            // global `:focus-visible` rule in `index.css` covers everything else.
            className="min-w-0 flex-1 focus:outline-none"
          >
            {children}
          </div>
          <StatusLine member={member} />
        </div>
      </div>
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  // The sidebar's brand is the ASCII banner; the mobile header has no room for
  // it and keeps the small mark.
  if (!compact) {
    return (
      <div className="px-2">
        <AsciiWordmark className="text-[0.6875rem] text-foreground" />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Club Operations
          {/* One blinking cursor for the whole app, beside the brand: the
              session is live. Decorative. */}
          <span aria-hidden="true" className="caret" />
        </p>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2.5", !compact && "px-2")}>
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center border border-screen-foreground/25 bg-screen font-display text-xs font-bold text-screen-foreground"
      >
        M
      </span>
      <div className="leading-tight">
        <p className="font-display text-sm tracking-[0.04em]">
          MAC
          {/* One blinking cursor for the whole app, beside the wordmark: the
              session is live. Decorative, so the text stays "MAC". */}
          {!compact && <span aria-hidden="true" className="caret" />}
        </p>
        {!compact && <p className="mt-1 text-xs text-muted-foreground">Club Operations</p>}
      </div>
    </div>
  );
}

function NavigationLink({
  to,
  label,
  icon: NavigationIcon,
  unread,
  compact = false,
}: {
  to: string;
  label: string;
  icon: Icon;
  unread: number;
  compact?: boolean;
}) {
  // Only the Inbox carries a count today, so the badge is keyed off the
  // destination rather than added to every row of `navigation`.
  const count = to === "/notifications" ? unread : 0;

  return (
    <NavLink
      to={to}
      end={to === "/"}
      // The count is in the link's own name, not just the pill: a screen reader
      // reaching "Inbox" should hear that three things are waiting without
      // having to find a separate element to read.
      aria-label={count > 0 ? `${label}, ${count} unread` : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center rounded-md text-sm text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground",
          compact
            ? "min-w-20 flex-1 flex-col gap-1 rounded-none px-1 py-2 text-[0.6875rem]"
            : "gap-3 px-3 py-2",
          isActive && "bg-accent font-medium text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The selection marker, same glyph as the page header: a marker bar
              rather than a fill, because the accent is never a background. */}
          {isActive && !compact && (
            <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-0 w-0.5 bg-ring" />
          )}
          <NavigationIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
          {count > 0 && (
            // `aria-hidden` because the link's own name already carries the
            // number; announcing it twice is how "Inbox 3 3" happens.
            <span
              aria-hidden="true"
              className={cn(
                "bg-primary px-1.5 py-0.5 text-[0.625rem] leading-none font-medium text-primary-foreground tabular-nums",
                compact ? "absolute top-1 right-1/4" : "ml-auto",
              )}
            >
              {badgeLabel(count)}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
