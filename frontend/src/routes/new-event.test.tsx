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
      event: detail({ startsAt: "2026-10-10T08:00:00.000Z" }),
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Semester Hackathon" },
  });
  // The start is a date and a time, so the two halves compose one local instant.
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-10" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "19:00" } });
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "Great Hall" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/events",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({
    title: "Semester Hackathon",
    venue: "Great Hall",
    // Local wall clock on the date typed, as an instant.
    startsAt: new Date(2026, 9, 10, 19, 0).toISOString(),
  });
});

it("seeds the start date from the calendar's day link, and ignores a date that is not one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) }),
  );

  // The form is filled in as usual; only the DATE half of the start is seeded.
  const seeded = renderPage("/events/new?date=2026-10-12");
  expect(screen.getByLabelText("Starts")).toHaveValue("2026-10-12");
  // Nothing was invented for the time, which is what the reader still decides.
  expect(screen.getByLabelText("Start time")).toHaveValue("");

  seeded.unmount();
  // Feb 30 is not a date, so the form opens exactly as the nav link leaves it.
  renderPage("/events/new?date=2026-02-30");
  expect(screen.getByLabelText("Starts")).toHaveValue("");
});

function renderPage(initialPath = "/events/new") {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/events/new" element={<NewEventPage />} />
        <Route path="/events/:id" element={<p>Created Event</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** `POST /api/events` answers with an EventDetail. */
function detail({ startsAt }: { startsAt: string }) {
  return {
    id: eventId,
    title: "Semester Hackathon",
    description: null,
    status: "planning",
    startsAt,
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
  };
}
