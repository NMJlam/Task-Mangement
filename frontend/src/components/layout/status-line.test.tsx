import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { StatusLine } from "./status-line";
import { NotificationsProvider, type NotificationsValue } from "@/hooks/use-notifications";

const member = {
  id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
  email: "jordan.lee@example.com",
  role: "officer",
  tier: 0,
} as const;

function feed(overrides: Partial<NotificationsValue>): NotificationsValue {
  return {
    state: { status: "ok", items: [], unreadCount: 3, loaded: 0, hasMore: false },
    loadingMore: false,
    mutationError: undefined,
    syncedAt: undefined,
    stale: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    ...overrides,
  };
}

const eventPath = "/events/018f3a4b-0000-7000-8000-00000000a1b2?tab=thread";

function Shell({ value, children }: { value: NotificationsValue; children: ReactNode }) {
  return (
    <MemoryRouter
      initialEntries={[eventPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NotificationsProvider value={value}>{children}</NotificationsProvider>
    </MemoryRouter>
  );
}

afterEach(() => vi.useRealTimers());

it("prints a prompt for the page, the unread count, and how fresh the feed is", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <Shell value={feed({ syncedAt: new Date(Date.now() - 3_000) })}>
      <StatusLine member={member} />
    </Shell>,
  );

  const line = screen.getByRole("contentinfo", { name: "Status line" });
  expect(line).toHaveTextContent("jordan.lee@mac:~/events/0000a1b2/thread$");
  expect(screen.getByRole("link", { name: /3 unread/ })).toHaveAttribute("href", "/notifications");
  expect(line).toHaveTextContent("synced 3s ago");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(line).toHaveTextContent("synced 4s ago");
});

it("says connecting before the first read", () => {
  render(
    <Shell value={feed({})}>
      <StatusLine member={member} />
    </Shell>,
  );

  expect(screen.getByRole("contentinfo")).toHaveTextContent("connecting…");
});

it("says offline when the latest read failed, not how long ago the last good one was", () => {
  render(
    <Shell value={feed({ syncedAt: new Date(), stale: true })}>
      <StatusLine member={member} />
    </Shell>,
  );

  const line = screen.getByRole("contentinfo");
  expect(line).toHaveTextContent("offline · retrying");
  expect(line).not.toHaveTextContent("synced");
});
