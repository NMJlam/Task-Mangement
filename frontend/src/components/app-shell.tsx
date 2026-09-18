import type { AuthUser } from "@ctp/shared";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckSquare2,
  HeartPulse,
  Landmark,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const navigation: { to: string; label: string; icon: Icon }[] = [
  { to: "/", label: "Overview", icon: HeartPulse },
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

export function AppShell({
  member,
  signOut,
  children,
}: {
  member: AuthUser;
  signOut: () => Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to Content
      </a>
      <div className="min-h-svh lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-svh flex-col border-r bg-card px-3 py-4 lg:flex">
          <Brand />
          <nav aria-label="Main navigation" className="mt-7 grid gap-1">
            {navigation.map((item) => (
              <NavigationLink key={item.to} {...item} />
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
              className="mt-3 w-full justify-start text-muted-foreground"
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
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
            className="sticky top-14 z-30 flex overflow-x-auto border-b bg-background/95 backdrop-blur lg:hidden"
          >
            {navigation.map((item) => (
              <NavigationLink key={item.to} {...item} compact />
            ))}
          </nav>
          <div id="main-content" tabIndex={-1} className="min-w-0 outline-none">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", !compact && "px-2")}>
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold tracking-tight text-primary-foreground"
      >
        M
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">MAC</p>
        {!compact && <p className="text-xs text-muted-foreground">Club Operations</p>}
      </div>
    </div>
  );
}

function NavigationLink({
  to,
  label,
  icon: NavigationIcon,
  compact = false,
}: {
  to: string;
  label: string;
  icon: Icon;
  compact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-md text-sm text-muted-foreground transition-[background-color,color] hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          compact
            ? "min-w-20 flex-1 flex-col gap-1 rounded-none px-1 py-2 text-[0.6875rem]"
            : "gap-3 px-3 py-2",
          isActive && "bg-accent font-medium text-accent-foreground",
        )
      }
    >
      <NavigationIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
