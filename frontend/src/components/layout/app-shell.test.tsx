import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

it("marks the current page and exposes account actions", () => {
  const signOut = vi.fn().mockResolvedValue(undefined);

  render(
    <MemoryRouter
      initialEntries={["/events"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppShell
        member={{
          id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
          email: "director@example.com",
          role: "director",
          tier: 1,
        }}
        signOut={signOut}
      >
        <main>Events Page</main>
      </AppShell>
    </MemoryRouter>,
  );

  expect(screen.getAllByRole("link", { name: "Events" })[0]).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  expect(signOut).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Skip to Content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
});
