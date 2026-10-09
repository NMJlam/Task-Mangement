import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { LoadingLine } from "./components/common/loading-line";
import { RequireAuth } from "./components/layout/require-auth";
import { RouteError } from "./components/layout/route-error";
import "./index.css";
import { applyTheme, storedTheme } from "./lib/theme";
import { HealthPage } from "./routes/health";
import { LoginPage } from "./routes/login";
import { NotFoundPage } from "./routes/not-found";

const AiBreakdownPage = lazy(() =>
  import("./routes/ai-breakdown").then(({ AiBreakdownPage }) => ({ default: AiBreakdownPage })),
);
const CalendarPage = lazy(() =>
  import("./routes/calendar").then(({ CalendarPage }) => ({ default: CalendarPage })),
);
const DashboardPage = lazy(() =>
  import("./routes/dashboard").then(({ DashboardPage }) => ({ default: DashboardPage })),
);
const EventDetailPage = lazy(() =>
  import("./routes/event-detail").then(({ EventDetailPage }) => ({ default: EventDetailPage })),
);
const EventsPage = lazy(() =>
  import("./routes/events").then(({ EventsPage }) => ({ default: EventsPage })),
);
const FinancePage = lazy(() =>
  import("./routes/finance").then(({ FinancePage }) => ({ default: FinancePage })),
);
const MembersPage = lazy(() =>
  import("./routes/members").then(({ MembersPage }) => ({ default: MembersPage })),
);
const MessagesPage = lazy(() =>
  import("./routes/messages").then(({ MessagesPage }) => ({ default: MessagesPage })),
);
const NewEventPage = lazy(() =>
  import("./routes/new-event").then(({ NewEventPage }) => ({ default: NewEventPage })),
);
const NotificationsPage = lazy(() =>
  import("./routes/notifications").then(({ NotificationsPage }) => ({
    default: NotificationsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./routes/settings").then(({ SettingsPage }) => ({ default: SettingsPage })),
);
const TasksPage = lazy(() =>
  import("./routes/tasks").then(({ TasksPage }) => ({ default: TasksPage })),
);

applyTheme(storedTheme());

const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <DashboardPage />
      </RequireAuth>
    ),
  },
  {
    path: "/health",
    element: (
      <RequireAuth>
        <HealthPage />
      </RequireAuth>
    ),
  },
  {
    path: "/events",
    element: (
      <RequireAuth>
        <EventsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/events/new",
    element: (
      <RequireAuth minTier={1}>
        <NewEventPage />
      </RequireAuth>
    ),
  },
  {
    path: "/events/:id",
    element: (
      <RequireAuth>
        <EventDetailPage />
      </RequireAuth>
    ),
  },
  {
    path: "/finance",
    element: (
      <RequireAuth>
        <FinancePage />
      </RequireAuth>
    ),
  },
  {
    path: "/calendar",
    element: (
      <RequireAuth>
        <CalendarPage />
      </RequireAuth>
    ),
  },
  {
    path: "/tasks",
    element: (
      <RequireAuth>
        <TasksPage />
      </RequireAuth>
    ),
  },
  {
    path: "/notifications",
    element: (
      <RequireAuth>
        <NotificationsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/members",
    element: (
      <RequireAuth>
        <MembersPage />
      </RequireAuth>
    ),
  },
  {
    path: "/messages",
    element: (
      <RequireAuth>
        <MessagesPage />
      </RequireAuth>
    ),
  },
  {
    path: "/ai",
    element: (
      <RequireAuth>
        <AiBreakdownPage />
      </RequireAuth>
    ),
  },
  // Static before dynamic, so "briefing" is never read as a chat id.
  {
    path: "/ai/briefing",
    element: (
      <RequireAuth>
        <AiBreakdownPage view="briefing" />
      </RequireAuth>
    ),
  },
  {
    path: "/ai/:chatId",
    element: (
      <RequireAuth>
        <AiBreakdownPage />
      </RequireAuth>
    ),
  },
  {
    path: "/settings",
    element: (
      <RequireAuth>
        <SettingsPage />
      </RequireAuth>
    ),
  },
  // Dev-only manual API harness. The dynamic import sits in the dead branch
  // of a production build, so Vite drops the page from the bundle.
  ...(import.meta.env.DEV
    ? [
        {
          path: "/scratch",
          lazy: async () => ({ Component: (await import("./routes/scratch")).ScratchPage }),
        },
      ]
    : []),
  // Last, so every real path above wins. Inside the shell, like any page.
  {
    path: "*",
    element: (
      <RequireAuth>
        <NotFoundPage />
      </RequireAuth>
    ),
  },
];

// One boundary for every page: a page that throws, or whose code fails to
// load, offers a way back instead of React Router's developer screen.
const router = createBrowserRouter([{ errorElement: <RouteError />, children: routes }]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center p-8">
          <LoadingLine label="Loading…" />
        </main>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>,
);
