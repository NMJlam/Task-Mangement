import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./notifications";
import {
  NotificationsProvider,
  pollIntervalFrom,
  useNotificationsSource,
} from "@/hooks/use-notifications";

/**
 * Mounts the page the way the app does — the feed lives on the shell and the
 * page consumes it — so the test covers the real wiring rather than a private
 * copy of the hook.
 */
function Harness() {
  const notifications = useNotificationsSource();
  return (
    <NotificationsProvider value={notifications}>
      <NotificationsPage />
    </NotificationsProvider>
  );
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Harness />
    </MemoryRouter>,
  );
}

const base = {
  id: "018f3a4b-0000-7000-8000-000000000001",
  userId: "018f3a4b-0000-7000-8000-000000000002",
  kind: "task_assigned",
  body: "You were assigned Confirm venue access.",
  entityType: "task",
  entityId: "018f3a4b-0000-7000-8000-000000000003",
  readAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
};

describe("NotificationsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows unread notifications and marks one as read", async () => {
    const fetchMock = stubFeed({
      feed: { notifications: [base], unreadCount: 1 },
      markRead: response({ notification: { ...base, readAt: "2026-09-18T01:00:00.000Z" } }),
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(base.body)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));

    await waitFor(() => expect(screen.getByText("0 unread notifications.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/notifications/${base.id}/read`, {
      method: "PATCH",
      credentials: "include",
    });
  });

  it("marks a row read on the click, before the server answers", async () => {
    stubFeed({ feed: { notifications: [base], unreadCount: 1 }, markRead: new Promise(() => {}) });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));

    expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
  });

  it("puts a row back to unread when marking it fails", async () => {
    stubFeed({
      feed: { notifications: [base], unreadCount: 1 },
      markRead: { ok: false, status: 503, json: async () => ({}) },
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to mark notification as read",
    );
    expect(screen.getByText("1 unread notification.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Read" })).toBeInTheDocument();
  });

  it("marks everything read on the click, before the server answers", async () => {
    const second = { ...base, id: "018f3a4b-0000-7000-8000-000000000009", body: "Second." };
    stubFeed({
      feed: { notifications: [base, second], unreadCount: 2 },
      markAll: new Promise(() => {}),
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark All Read" }));

    expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
  });

  describe("polling", () => {
    afterEach(() => vi.useRealTimers());

    it("picks up a new notification within a second", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const later = { ...base, id: "018f3a4b-0000-7000-8000-000000000010", body: "Arrived." };
      const fetchMock = stubFeed({ feed: { notifications: [base], unreadCount: 1 } });

      renderPage();
      await screen.findByText(base.body);
      fetchMock.feed = { notifications: [later, base], unreadCount: 2 };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(await screen.findByText(later.body)).toBeInTheDocument();
      expect(screen.getByText("2 unread notifications.")).toBeInTheDocument();
    });

    it("does not let a poll answered before a mark landed flash the row back", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let land: (value: unknown) => void = () => {};
      stubFeed({
        feed: { notifications: [base], unreadCount: 1 },
        markRead: new Promise((resolve) => (land = resolve)),
      });

      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));
      // The server has not seen the mark yet, so every poll still says unread.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
      land(response({ notification: { ...base, readAt: "2026-09-18T01:00:00.000Z" } }));
    });

    it("keeps rows paged in with Load More when the feed polls", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const page = Array.from({ length: 50 }, (_, index) => ({
        ...base,
        id: `018f3a4b-0000-7000-8000-${String(100 + index).padStart(12, "0")}`,
        body: `Row ${index}.`,
        createdAt: new Date(Date.UTC(2026, 8, 18) - index * 60_000).toISOString(),
      }));
      const oldest = {
        ...base,
        id: "018f3a4b-0000-7000-8000-000000000999",
        body: "From the second page.",
        createdAt: "2026-09-01T00:00:00.000Z",
      };
      stubFeed({
        feed: { notifications: page, unreadCount: 51 },
        secondPage: { notifications: [oldest], unreadCount: 51 },
      });

      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Load More" }));
      await screen.findByText(oldest.body);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(screen.getByText(oldest.body)).toBeInTheDocument();
    });
  });

  /**
   * `entityType`/`entityId` shipped on every row as "a deep-link target" and
   * were rendered by nothing, so each notification named a task it could not
   * open. These two cases pin the mapping and its refusal to guess.
   */
  it("carries the id for an entity that has a route of its own", async () => {
    const onEvent = {
      ...base,
      kind: "event_cancelled",
      body: "Semester Hackathon was cancelled.",
      entityType: "event",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [onEvent], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: onEvent.body })).toHaveAttribute(
        "href",
        `/events/${onEvent.entityId}`,
      ),
    );
  });

  /**
   * The board has no per-task URL, so the id stays OUT of the link. A `?task=`
   * that no page reads looks like a working deep link and silently is not —
   * which is exactly the state this assertion exists to prevent returning to.
   */
  it("links to the page but not the row when the row has no route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [base], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: base.body })).toHaveAttribute("href", "/tasks"),
    );
  });

  it("leaves a notification with no reachable entity as plain text", async () => {
    const orphan = { ...base, entityType: null, entityId: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [orphan], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(orphan.body)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: orphan.body })).not.toBeInTheDocument();
  });

  it("offers Load More only while a full page came back", async () => {
    // One short page: the feed is smaller than the 50-row limit, so there is
    // nothing further to ask for.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [base], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(base.body)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
  });
});

describe("pollIntervalFrom", () => {
  it("takes a positive whole number of milliseconds", () => {
    expect(pollIntervalFrom("5000")).toBe(5_000);
  });

  it.each([undefined, "", "abc", "0", "-5", "1.5"])("falls back to a second for %j", (raw) => {
    expect(pollIntervalFrom(raw)).toBe(1_000);
  });
});

/**
 * Routes by URL and method rather than by call order: the feed polls every
 * second, so a test that runs past one would hand a queued PATCH response to a
 * poll. `feed` is read on every list call, so a test can change it mid-way.
 */
function stubFeed(stubs: {
  feed: unknown;
  secondPage?: unknown;
  markRead?: unknown;
  markAll?: unknown;
}) {
  const fetchMock = Object.assign(
    vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return input.endsWith("/read-all")
          ? (stubs.markAll ?? response({ count: 0 }))
          : stubs.markRead;
      }
      if (input.includes("offset=")) return response(stubs.secondPage);
      return response(fetchMock.feed);
    }),
    { feed: stubs.feed },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
