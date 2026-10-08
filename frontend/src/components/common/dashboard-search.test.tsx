import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { DashboardSearch } from "./dashboard-search";

const member = {
  id: "018f3a4b-0000-7000-8000-000000000001",
  name: "Jordan Lee",
  email: "jordan@example.com",
  role: "officer" as const,
  tier: 0 as const,
  teamIds: [],
  portfolio: null,
  createdAt: new Date("2026-01-10T00:00:00.000Z"),
};

/**
 * The search field fills the dialog's header and the results fill a scrolling
 * list, and both containers clip. The app's focus outline is drawn 2px OUTSIDE
 * a control, so on these it was cut off at the dialog's edge; it is drawn
 * inside them instead (`-outline-offset-2`), the same box, just fitted.
 */
it("draws the field's and each result's focus outline inside them, so the dialog does not cut it off", () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DashboardSearch tasks={[]} events={[]} members={[member]} />
    </MemoryRouter>,
  );

  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const field = screen.getByRole("textbox", { name: "Search Club Workspace" });
  fireEvent.change(field, { target: { value: "Jordan" } });

  expect(field).toHaveClass("-outline-offset-2");
  expect(screen.getByRole("link", { name: /jordan lee/i })).toHaveClass("-outline-offset-2");
});
