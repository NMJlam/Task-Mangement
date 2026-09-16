import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { RequireAuth } from "./components/require-auth";
import "./index.css";
import { HealthPage } from "./routes/health";
import { LoginPage } from "./routes/login";

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
