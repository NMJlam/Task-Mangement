import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventDetailPage } from "./event-detail";

describe("EventDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders event details and the embedded task board", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        event: {
          id: "018f3a4b-0000-7000-8000-000000000001",
          title: "Winter Showcase",
          description: "An evening of student work.",
          status: "planning",
          startsAt: "2026-07-20T09:00:00.000Z",
          endsAt: null,
          venue: "Guild Hall",
          minTier: 0,
          owner: null,
          attendanceEstimate: 120,
          taskCounts: { todo: 1, inProgress: 0, blocked: 0, done: 0 },
          overdueCount: 0,
          budget: { allocationCents: 50000, committedCents: 12000, spentCents: 0 },
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          tasks: [
            {
              id: "018f3a4b-0000-7000-8000-000000000002",
              eventId: "018f3a4b-0000-7000-8000-000000000001",
              teamId: null,
              assignee: null,
              creator: null,
              title: "Confirm lighting",
              status: "todo",
              priority: "high",
              dueAt: "2026-07-10T09:00:00.000Z",
              boardOrder: 0,
              minTier: 0,
              completedAt: null,
              aiRunId: null,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/events/018f3a4b-0000-7000-8000-000000000001"]}>
        <Routes>
          <Route path="/events/:id" element={<EventDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Confirm lighting")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events/018f3a4b-0000-7000-8000-000000000001?include=tasks",
      { credentials: "include" },
    );
  });
});
