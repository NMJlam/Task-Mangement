import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { NotificationsProvider, type NotificationsValue } from "@/hooks/use-notifications";

/**
 * A static feed rather than the real hook: the shell only reads `unreadCount`,
 * and driving a fetch here would test `useNotificationsSource` instead of the
 * badge.
 */
function feed(unreadCount: number): NotificationsValue {
  return {
    state: { status: "ok", items: [], unreadCount, loaded: 0, hasMore: false },
    busy: undefined,
    loadingMore: false,
    mutationError: undefined,
    loadMore: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  };
}

function renderShell(unreadCount: number, signOut = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <MemoryRouter
      initialEntries={["/events"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NotificationsProvider value={feed(unreadCount)}>
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
      </NotificationsProvider>
    </MemoryRouter>,
  );
}

it("marks the current page and exposes account actions", () => {
  const signOut = vi.fn().mockResolvedValue(undefined);

  renderShell(0, signOut);

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

it("carries the unread count in the Inbox link's own name", () => {
  renderShell(3);

  // Both navs render the badge, and the count belongs to the link's accessible
  // name — a pill the screen reader has to go looking for is not a notification.
  expect(screen.getAllByRole("link", { name: "Inbox, 3 unread" })).toHaveLength(2);
  expect(screen.getAllByText("3")).toHaveLength(2);
});

it("shows no badge on an empty inbox, and caps a large one", () => {
  const { unmount } = renderShell(0);
  expect(screen.getAllByRole("link", { name: "Inbox" })).toHaveLength(2);
  unmount();

  renderShell(150);
  expect(screen.getAllByRole("link", { name: "Inbox, 150 unread" })).toHaveLength(2);
  expect(screen.getAllByText("99+")).toHaveLength(2);
});
