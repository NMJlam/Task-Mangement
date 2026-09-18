import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RequireAuth } from "./components/require-auth";
import "./index.css";
import { CalendarPage } from "./routes/calendar";
import { EventDetailPage } from "./routes/event-detail";
import { EventsPage } from "./routes/events";
import { FinancePage } from "./routes/finance";
import { HealthPage } from "./routes/health";
import { LoginPage } from "./routes/login";
import { MembersPage } from "./routes/members";
import { MessagesPage } from "./routes/messages";
import { NotificationsPage } from "./routes/notifications";
import { TasksPage } from "./routes/tasks";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <HealthPage />
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
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
