import {
  markAllNotificationsReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  type Notification,
  type NotificationListResponse,
} from "@ctp/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";

/** Sent explicitly: a full page is the only end-of-list signal the API gives. */
const PAGE_SIZE = 50;

/**
 * How often the feed re-reads while the tab is in front. A notification is the
 * one thing here that arrives without the reader doing anything, so it is the
 * one read that earns a timer rather than waiting for a focus event.
 *
 * One second, so a mention or an assignment lands while the sender is still
 * looking at it. That is a request a second per open tab — each one a function
 * invocation and two indexed reads on Vercel + Neon — so a deployment can slow
 * it with `VITE_NOTIFICATION_POLL_MS` (docs/setup.md).
 */
const DEFAULT_POLL_MS = 1_000;

/**
 * The poll interval a deployment asked for. Vite inlines `VITE_*` at build
 * time, so a new value on Vercel takes a redeploy, not just a save. Anything
 * but a positive whole number of milliseconds falls back to the default rather
 * than polling in a tight loop or never.
 */
export function pollIntervalFrom(raw: string | undefined): number {
  const ms = Number(raw);
  return Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_POLL_MS;
}

const POLL_MS = pollIntervalFrom(import.meta.env.VITE_NOTIFICATION_POLL_MS);

type Feed = {
  status: "ok";
  items: Notification[];
  unreadCount: number;
  loaded: number;
  hasMore: boolean;
};

type NotificationState = { status: "loading" } | Feed | { status: "error"; message: string };

/**
 * Lays a fresh first page over the feed. A poll only ever reads the first page,
 * so rows the reader paged in with Load More are kept below it — at a poll a
 * second, replacing the feed outright would take them away before they could
 * be read.
 *
 * A held row stays only if it sorts at or after the page's oldest row: anything
 * newer than that is on the page, or no longer exists.
 */
function withFirstPage(current: NotificationState, page: NotificationListResponse): Feed {
  const fresh = page.notifications;
  const firstPage: Feed = {
    status: "ok",
    items: fresh,
    unreadCount: page.unreadCount,
    loaded: fresh.length,
    hasMore: fresh.length === PAGE_SIZE,
  };
  const oldest = fresh.at(-1)?.createdAt.getTime();
  if (current.status !== "ok" || current.loaded <= PAGE_SIZE || oldest === undefined) {
    return firstPage;
  }

  const onPage = new Set(fresh.map((row) => row.id));
  const older = current.items.filter(
    (item) => !onPage.has(item.id) && item.createdAt.getTime() <= oldest,
  );
  if (older.length === 0) return firstPage;
  return {
    ...firstPage,
    items: [...fresh, ...older],
    loaded: fresh.length + older.length,
    hasMore: current.hasMore,
  };
}

/**
 * Undoes an optimistic read whose request failed: every row still carrying the
 * stamp the click put on it goes back to unread. A row read since by any other
 * path carries a different stamp and keeps it.
 */
function unmarkLocally(current: NotificationState, stamp: Date): NotificationState {
  if (current.status !== "ok") return current;
  let reverted = 0;
  const items = current.items.map((item) => {
    if (item.readAt !== stamp) return item;
    reverted += 1;
    return { ...item, readAt: null };
  });
  return { ...current, items, unreadCount: current.unreadCount + reverted };
}

export function useNotificationsSource() {
  const [state, setState] = useState<NotificationState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationError, setMutationError] = useState<string>();

  // At a poll a second, a read can still be on the wire when the next tick
  // fires. Starting another anyway would, on a slow link, have every tick
  // supersede the last so that none ever lands — so a tick that finds a read in
  // flight is skipped instead.
  const reading = useRef(false);
  const mounted = useRef(false);
  // Marks in flight, and an epoch bumped as each starts and as it settles. A
  // read that overlapped a mark may have been answered before the write landed,
  // and applying it would flash the row back to unread; it is dropped instead,
  // and the next tick is a second away.
  const writes = useRef({ open: 0, epoch: 0 });

  const reload = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    const epoch = writes.current.epoch;
    fetch(`/api/notifications?limit=${PAGE_SIZE}`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load notifications");
        return notificationListResponseSchema.parse(await response.json());
      })
      .then((page) => {
        if (!mounted.current || writes.current.open > 0 || writes.current.epoch !== epoch) return;
        setState((current) => withFirstPage(current, page));
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        // A poll that fails must not replace a feed the reader can still use
        // with an error — only a cold load has nothing to keep.
        setState((current) =>
          current.status === "ok"
            ? current
            : {
                status: "error",
                message: cause instanceof Error ? cause.message : "Failed to load notifications",
              },
        );
      })
      .finally(() => {
        reading.current = false;
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  useRevalidate(reload, { intervalMs: POLL_MS });

  const beginWrite = useCallback(() => {
    writes.current.open += 1;
    writes.current.epoch += 1;
  }, []);

  const endWrite = useCallback(() => {
    writes.current.open -= 1;
    writes.current.epoch += 1;
  }, []);

  const loadMore = useCallback(async () => {
    if (state.status !== "ok" || !state.hasMore || loadingMore) return;
    setLoadingMore(true);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/notifications?limit=${PAGE_SIZE}&offset=${state.loaded}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load more notifications");
      const page = notificationListResponseSchema.parse(await response.json());
      setState((current) =>
        current.status === "ok"
          ? {
              status: "ok",
              items: [
                ...current.items,
                ...page.notifications.filter(
                  (row) => !current.items.some((held) => held.id === row.id),
                ),
              ],
              // The count travels with every page and is the server's, not a
              // running tally, so the newest one wins.
              unreadCount: page.unreadCount,
              loaded: current.loaded + page.notifications.length,
              hasMore: page.notifications.length === PAGE_SIZE,
            }
          : current,
      );
    } catch (cause) {
      setMutationError(
        cause instanceof Error ? cause.message : "Failed to load more notifications",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore]);

  // Both marks are optimistic: the row reads as read on the click, not a round
  // trip later. A failure puts it back (`unmarkLocally`) and says so.

  const markRead = useCallback(
    async (notification: Notification) => {
      if (notification.readAt) return;
      const stamp = new Date();
      setMutationError(undefined);
      setState((current) => {
        if (current.status !== "ok") return current;
        const target = current.items.find((item) => item.id === notification.id);
        if (!target || target.readAt) return current;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === notification.id ? { ...item, readAt: stamp } : item,
          ),
          unreadCount: Math.max(0, current.unreadCount - 1),
        };
      });
      beginWrite();
      try {
        const response = await fetch(`/api/notifications/${notification.id}/read`, {
          method: "PATCH",
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to mark notification as read");
        const updated = notificationResponseSchema.parse(await response.json()).notification;
        setState((current) =>
          current.status === "ok"
            ? {
                ...current,
                items: current.items.map((item) => (item.id === updated.id ? updated : item)),
              }
            : current,
        );
      } catch (cause) {
        setMutationError(cause instanceof Error ? cause.message : "Failed to update notification");
        setState((current) => unmarkLocally(current, stamp));
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite],
  );

  const markAllRead = useCallback(async () => {
    const stamp = new Date();
    setMutationError(undefined);
    setState((current) =>
      current.status === "ok"
        ? {
            ...current,
            items: current.items.map((item) => (item.readAt ? item : { ...item, readAt: stamp })),
            // Every unread row, loaded or not — which is what the server marks.
            unreadCount: 0,
          }
        : current,
    );
    beginWrite();
    let failed = false;
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "PATCH",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to mark notifications as read");
      markAllNotificationsReadResponseSchema.parse(await response.json());
    } catch (cause) {
      failed = true;
      setMutationError(cause instanceof Error ? cause.message : "Failed to update notifications");
      setState((current) => unmarkLocally(current, stamp));
    } finally {
      endWrite();
    }
    // The undo restores the rows on screen, but the count it zeroed also
    // covered unread rows past the loaded pages; the server has the true figure.
    if (failed) reload();
  }, [beginWrite, endWrite, reload]);

  return { state, loadingMore, mutationError, loadMore, reload, markRead, markAllRead };
}

export type NotificationsValue = ReturnType<typeof useNotificationsSource>;

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);

export const NotificationsProvider = NotificationsContext.Provider;

/**
 * The feed, shared.
 *
 * ONE instance for the whole signed-in app, owned by the shell. Two callers
 * mounting their own copy — the sidebar badge and the Inbox page — would poll
 * twice and, worse, disagree: marking a row read on the page would leave the
 * badge counting it, because the two states have no way to reach each other.
 *
 * Throws rather than falling back to a private instance, which would reintroduce
 * exactly that split silently.
 */
export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("useNotifications must be used inside the signed-in app shell.");
  }
  return value;
}
