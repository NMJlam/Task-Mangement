import {
  markAllNotificationsReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  type Notification,
} from "@ctp/shared";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";

/** Sent explicitly: a full page is the only end-of-list signal the API gives. */
const PAGE_SIZE = 50;

/**
 * How often the feed re-reads while the tab is in front. A notification is the
 * one thing here that arrives without the reader doing anything, so it is the
 * one read that earns a timer rather than waiting for a focus event.
 */
const POLL_MS = 60_000;

type NotificationState =
  | { status: "loading" }
  | { status: "ok"; items: Notification[]; unreadCount: number; loaded: number; hasMore: boolean }
  | { status: "error"; message: string };

export function useNotificationsSource() {
  const [state, setState] = useState<NotificationState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    fetch(`/api/notifications?limit=${PAGE_SIZE}`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load notifications");
        return notificationListResponseSchema.parse(await response.json());
      })
      .then((result) => {
        if (active) {
          setState({
            status: "ok",
            items: result.notifications,
            unreadCount: result.unreadCount,
            loaded: result.notifications.length,
            hasMore: result.notifications.length === PAGE_SIZE,
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
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
        }
      });
    return () => {
      active = false;
    };
  }, [generation]);

  useRevalidate(reload, { intervalMs: POLL_MS });

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

  const markRead = useCallback(async (notification: Notification) => {
    if (notification.readAt) return;
    setBusy(notification.id);
    setMutationError(undefined);
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
              unreadCount: Math.max(0, current.unreadCount - 1),
            }
          : current,
      );
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to update notification");
    } finally {
      setBusy(undefined);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setBusy("all");
    setMutationError(undefined);
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "PATCH",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to mark notifications as read");
      markAllNotificationsReadResponseSchema.parse(await response.json());
      const readAt = new Date();
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
              unreadCount: 0,
            }
          : current,
      );
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to update notifications");
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { state, busy, loadingMore, mutationError, loadMore, reload, markRead, markAllRead };
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
