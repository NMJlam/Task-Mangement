import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewEventPage } from "./new-event";

const eventId = "018f3a4b-0000-7000-8000-000000000002";

// The pickers open on the current month, so the day the tests click has to be
// in it: pinned to early October 2026.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 1, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("creates an event and opens its detail page", async () => {
  const fetchMock = stubApi("director");

  renderPage();

  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Semester Hackathon" },
  });
  // The same day-and-time picker as Edit dates, composing one local instant.
  await pick("Starts", "2026-10-10", "19:00");
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "Great Hall" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/events",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );

  expect(postedBody(fetchMock)).toMatchObject({
    title: "Semester Hackathon",
    venue: "Great Hall",
    // Local wall clock on the date typed, as an instant.
    startsAt: new Date(2026, 9, 10, 19, 0).toISOString(),
  });
});

it("lets only a budget manager allocate, and sends no allocation for anyone else", async () => {
  const asDirector = stubApi("director");
  const director = renderPage();
  const field = screen.getByLabelText("Budget Allocation (AUD)");
  // The capability arrives with /api/me, so the field starts out locked.
  expect(field).toBeDisabled();
  expect(field).toHaveAccessibleDescription(/president or treasurer/i);
  await fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(postedBody(asDirector)).not.toHaveProperty("allocationCents");
  director.unmount();

  const asTreasurer = stubApi("treasurer");
  renderPage();
  await waitFor(() => expect(screen.getByLabelText("Budget Allocation (AUD)")).toBeEnabled());
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Budget Allocation (AUD)"), {
    target: { value: "250" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(postedBody(asTreasurer)).toMatchObject({ allocationCents: 25000 });
});

it("seeds the start date from the calendar's day link, and ignores a date that is not one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) }),
  );

  // Only the DAY of the start is seeded: the picker opens on it, and the
  // trigger says the time is still the reader's to give.
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const seeded = renderPage("/events/new?date=2026-10-12");
  expect(screen.getByLabelText("Starts")).toHaveTextContent(/choose a time/);
  await user.click(screen.getByLabelText("Starts"));
  expect(document.querySelector('[data-day="2026-10-12"]')).toHaveAttribute(
    "data-selected",
    "true",
  );
  // Nothing was invented for the time.
  expect(screen.getByLabelText("Start time")).toHaveValue("");

  seeded.unmount();
  // Feb 30 is not a date, so the form opens exactly as the nav link leaves it.
  renderPage("/events/new?date=2026-02-30");
  expect(screen.getByLabelText("Starts")).toHaveTextContent("Select start date");
});

it("asks for a start before sending anything", async () => {
  const fetchMock = stubApi("director");
  renderPage();

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Semester Hackathon" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/choose a start date and time/i);
  expect(fetchMock).not.toHaveBeenCalledWith("/api/events", expect.anything());
});

it("takes an optional end from the same picker, and refuses one before the start", async () => {
  const fetchMock = stubApi("director");
  renderPage();

  await fillRequired();
  await pick("Ends", "2026-10-09", "21:00");
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/end time must be after the start/i);
  expect(fetchMock).not.toHaveBeenCalledWith("/api/events", expect.anything());

  await pick("Ends", "2026-10-10", "22:00");
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
  await waitFor(() => expect(screen.getByText("Created Event")).toBeInTheDocument());
  expect(postedBody(fetchMock)).toMatchObject({
    endsAt: new Date(2026, 9, 10, 22, 0).toISOString(),
  });
});

/** `/api/me` as `role`; every other call is the create answering 201. */
function stubApi(role: "director" | "treasurer") {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      url === "/api/me"
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              user: {
                id: "018f3a4b-0000-7000-8000-00000000000f",
                email: `${role}@example.com`,
                role,
                tier: role === "treasurer" ? 2 : 1,
              },
            }),
          }
        : {
            ok: true,
            status: 201,
            json: async () => ({ event: detail({ startsAt: "2026-10-10T08:00:00.000Z" }) }),
          },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The body of the one `POST /api/events` the form sent. */
function postedBody(fetchMock: ReturnType<typeof vi.fn>): object {
  const call = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  return JSON.parse(String((call as [string, RequestInit])[1].body)) as object;
}

async function fillRequired() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Semester Hackathon" } });
  await pick("Starts", "2026-10-10", "19:00");
}

/**
 * Sets a date through the form's picker, as a reader does: open it from its
 * label, click the day (by `data-day`, which does not depend on the locale),
 * give the time and Apply.
 */
async function pick(field: "Starts" | "Ends", isoDate: string, time: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByLabelText(field));
  const popover = screen.getByRole("dialog");
  const cell = document.querySelector(`[data-day="${isoDate}"]`);
  if (!cell) throw new Error(`No calendar cell for ${isoDate}`);
  await user.click(within(cell as HTMLElement).getByRole("button"));
  const timeField = within(popover).getByLabelText(field === "Starts" ? "Start time" : "End time");
  await user.clear(timeField);
  await user.type(timeField, time);
  await user.click(within(popover).getByRole("button", { name: "Apply" }));
}

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
