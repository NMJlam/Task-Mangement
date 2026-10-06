import { render, screen } from "@testing-library/react";
import { lazy } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { RouteError } from "./route-error";
import { NotFoundPage } from "@/routes/not-found";

afterEach(() => vi.restoreAllMocks());

function Broken(): never {
  throw new Error("Cannot read properties of undefined");
}

// A tab left open across a deploy asks for a page file the new build dropped.
const Stale = lazy(() =>
  Promise.reject(
    new TypeError("Failed to fetch dynamically imported module: /assets/stale-abc123.js"),
  ),
);

/** The same shape as `main.tsx`: one boundary above every page. */
function renderAt(path: string) {
  const routes: RouteObject[] = [
    { path: "/broken", element: <Broken /> },
    { path: "/stale", element: <Stale /> },
    { path: "*", element: <NotFoundPage /> },
  ];
  const router = createMemoryRouter([{ errorElement: <RouteError />, children: routes }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

it("shows a way back, not a stack trace, when a page throws", async () => {
  // React reports the caught error; the test only cares what the reader sees.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  renderAt("/broken");

  expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  expect(screen.queryByText(/cannot read properties/i)).not.toBeInTheDocument();
});

it("asks for a reload when a page's code is gone after a deploy", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  renderAt("/stale");

  expect(
    await screen.findByRole("heading", { name: "A new version is available" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
});

it("answers an address no route claims with a not-found page", async () => {
  renderAt("/no-such-page");

  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
});
