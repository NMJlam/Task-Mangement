import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventsPage } from "./events";

describe("EventsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the empty state when there are no events", async () => {
    stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument());
  });

  it("renders a card per event when the list is non-empty", async () => {
    stubFetch({
      items: [
        {
          id: "018f3a4b-0000-7000-8000-000000000001",
          title: "AGM",
          status: "planning",
          startsAt: "2026-11-01T10:00:00.000Z",
          endsAt: null,
          venue: null,
          minTier: 0,
          owner: null,
          taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
          overdueCount: 0,
          budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
        },
      ],
      nextCursor: null,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "AGM" })).toHaveAttribute(
      "href",
      "/events/018f3a4b-0000-7000-8000-000000000001",
    );
    expect(screen.queryByText(/no upcoming events/i)).not.toBeInTheDocument();
  });
});

function renderPage() {
  render(
    <MemoryRouter>
      <EventsPage />
    </MemoryRouter>,
  );
}

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
  );
}
