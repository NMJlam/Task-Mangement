import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NewEventPage } from "./new-event";

const eventId = "018f3a4b-0000-7000-8000-000000000002";

afterEach(() => vi.unstubAllGlobals());

it("creates an event and opens its detail page", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({
      event: {
        id: eventId,
        title: "Semester Hackathon",
        description: null,
        status: "planning",
        startsAt: "2026-10-10T08:00:00.000Z",
        endsAt: null,
        venue: "Great Hall",
        attendanceEstimate: null,
        minTier: 0,
        owner: null,
        taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
        overdueCount: 0,
        budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
        createdAt: "2026-09-18T00:00:00.000Z",
        updatedAt: "2026-09-18T00:00:00.000Z",
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter
      initialEntries={["/events/new"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/events/new" element={<NewEventPage />} />
        <Route path="/events/:id" element={<p>Created Event</p>} />
      </Routes>
    </MemoryRouter>,
  );

  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Semester Hackathon" },
  });
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-10-10T19:00" },
  });
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "Great Hall" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/events",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );
});
