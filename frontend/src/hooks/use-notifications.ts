import {
  markAllNotificationsReadResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  type Notification,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type NotificationState =
  | { status: "loading" }
  | { status: "ok"; items: Notification[]; unreadCount: number }
  | { status: "error"; message: string };

export function useNotifications() {
  const [state, setState] = useState<NotificationState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch("/api/notifications", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load notifications");
        return notificationListResponseSchema.parse(await response.json());
      })
      .then((result) => {
        if (active) {
          setState({ status: "ok", items: result.notifications, unreadCount: result.unreadCount });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load notifications",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

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

  return { state, busy, mutationError, markRead, markAllRead };
}
