import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
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
    stubFetch({ items: [summary("AGM")], nextCursor: null });
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "AGM" })).toHaveAttribute(
      "href",
      `/events/${idFor("AGM")}`,
    );
    expect(screen.queryByText(/no upcoming events/i)).not.toBeInTheDocument();
  });

  it("makes the whole card a click target without swallowing the card text", async () => {
    stubFetch({ items: [summary("AGM")], nextCursor: null });
    renderPage();

    const link = await screen.findByRole("link", { name: "AGM" });
    // The link stretches over the card via a pseudo-element, so the accessible
    // name stays the title — wrapping the card in an anchor would read the venue,
    // status and progress out as part of the link text.
    expect(link.className).toContain("after:absolute");
    expect(link.closest("[data-slot='card']")).toHaveClass("relative");
  });

  it("shows an actionable error when the API returns an HTML error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'")),
      }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load events: Failed to load events. Refresh the page to try again.",
    );
  });

  it("asks the API for upcoming events by default, in start order", async () => {
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    const url = await waitFor(() => {
      const request = lastEventsRequest(fetchMock);
      expect(request).toBeDefined();
      return request!;
    });
    expect(url.pathname).toBe("/api/events");
    expect(url.searchParams.get("from")).toBeTruthy();
    expect(url.searchParams.get("to")).toBeNull();
    // Soonest first is part of the READ: the default order is newest-first, so a
    // capped upcoming page would hold the furthest-future events.
    expect(url.searchParams.get("order")).toBe("asc");
  });

  it("keeps Past and All in the default order, which needs no client re-sort", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();
    await waitFor(() => expect(lastEventsRequest(fetchMock)).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Past" }));
    await waitFor(() => expect(lastEventsRequest(fetchMock)!.searchParams.get("to")).toBeTruthy());
    expect(lastEventsRequest(fetchMock)!.searchParams.get("order")).toBeNull();

    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => {
      const params = lastEventsRequest(fetchMock)!.searchParams;
      expect(params.get("to")).toBeNull();
      expect(params.get("from")).toBeNull();
    });
    expect(lastEventsRequest(fetchMock)!.searchParams.get("order")).toBeNull();
  });

  it("owns the list in the URL, and clears every filter at once", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") return Promise.resolve(ok({ user: me({ role: "officer", tier: 0 }) }));
      return Promise.resolve(ok({ items: [], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage("/events?time=past&status=live&owner=mine");

    // Every filter in the URL becomes a query parameter, including the owner.
    const filtered = await waitFor(() => {
      const request = lastEventsRequest(fetchMock);
      expect(request).toBeDefined();
      return request!;
    });
    expect(filtered.searchParams.get("ownerId")).toBe(idFor("me"));
    expect(filtered.searchParams.get("status")).toBe("live");
    expect(filtered.searchParams.get("to")).toBeTruthy();

    expect(await screen.findByText("0 events match.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear Filters" }));

    await waitFor(() =>
      expect(lastEventsRequest(fetchMock)!.searchParams.get("ownerId")).toBeNull(),
    );
    expect(lastEventsRequest(fetchMock)!.searchParams.get("status")).toBeNull();
    expect(lastEventsRequest(fetchMock)!.searchParams.get("from")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("names the active filters when the list comes back empty", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") return Promise.resolve(ok({ user: me({ role: "officer", tier: 0 }) }));
      return Promise.resolve(ok({ items: [], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage("/events?time=past&status=live&owner=mine");

    expect(
      await screen.findByText(/No events match these filters: owned by you, live/),
    ).toBeInTheDocument();
  });

  it("cannot answer My Events without identity, and says so instead of listing everyone's", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          url === "/api/me"
            ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
            : Promise.resolve(ok({ items: [], nextCursor: null })),
        ),
    );
    renderPage("/events?owner=mine");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your membership, so your events can't be listed.",
    );
    expect(screen.getByRole("link", { name: "Show all events" })).toHaveAttribute(
      "href",
      "/events",
    );
  });

  it("swaps from= for to= when the reader asks for past events", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Past" }));

    await waitFor(() => {
      const [url] = fetchMock.mock.calls.at(-1) as [string];
      expect(url).toContain("to=");
      expect(url).not.toContain("from=");
    });
  });

  it("passes the chosen status through, cancelled included", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText("Status"), "cancelled");

    await waitFor(() => {
      const [url] = fetchMock.mock.calls.at(-1) as [string];
      expect(url).toContain("status=cancelled");
    });
  });

  it("appends the next page and hides the button at the end of the list", async () => {
    const user = userEvent.setup();
    // Routed by URL, not call order — `useMe` also fetches, and the page may
    // reorder its calls.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") return Promise.resolve(ok({ user: me({ role: "officer", tier: 0 }) }));
      return Promise.resolve(
        url.includes("cursor=abc")
          ? ok({ items: [summary("Showcase")], nextCursor: null })
          : ok({ items: [summary("AGM")], nextCursor: "abc" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => expect(screen.getByText("Showcase")).toBeInTheDocument());
    expect(screen.getByText("AGM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain("cursor=abc");
  });

  it("hides the create link from tier 0", async () => {
    stubWithMe({ role: "officer", tier: 0 });
    renderPage();

    await waitFor(() => expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /new event/i })).not.toBeInTheDocument();
  });

  it("points tier 1 at the create page rather than posting from the list", async () => {
    const fetchMock = stubWithMe({ role: "director", tier: 1 });
    renderPage();

    // Creating lives on /events/new, which validates the full createEventSchema.
    expect(await screen.findByRole("link", { name: /new event/i })).toHaveAttribute(
      "href",
      "/events/new",
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });
});

function renderPage(initialPath = "/events") {
  render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <EventsPage />
    </MemoryRouter>,
  );
}

/** The event-list read. `useMe` also fetches, and the page may reorder its calls. */
function lastEventsRequest(fetchMock: Mock): URL | undefined {
  const call = fetchMock.mock.calls
    .filter(([input]) => String(input).startsWith("/api/events"))
    .at(-1);
  return call ? new URL(String(call[0]), "http://localhost") : undefined;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(ok(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function me(user: { role: string; tier: number }) {
  return { id: idFor("me"), email: "a@b.c", ...user };
}

/** Routes `/api/me`, the POST and the list read separately so tier can vary per test. */
function stubWithMe(user: { role: string; tier: number }) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/me") return Promise.resolve(ok({ user: me(user) }));
    if (init?.method === "POST") return Promise.resolve(ok({ event: detail("AGM") }));
    return Promise.resolve(ok({ items: [], nextCursor: null }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function idFor(title: string) {
  return `018f3a4b-0000-7000-8000-${title.length.toString().padStart(12, "0")}`;
}

function summary(title: string) {
  return {
    id: idFor(title),
    title,
    status: "planning",
    startsAt: "2026-11-01T10:00:00.000Z",
    endsAt: null,
    venue: null,
    minTier: 0,
    owner: null,
    taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
    overdueCount: 0,
    budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
  };
}

/** `POST /api/events` answers with an EventDetail, not the list's EventSummary. */
function detail(title: string) {
  return {
    ...summary(title),
    description: null,
    attendanceEstimate: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  };
}
