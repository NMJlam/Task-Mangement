import {
  messageListResponseSchema,
  messageResponseSchema,
  threadListResponseSchema,
  threadResponseSchema,
  type Message,
  type Thread,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type ThreadsState =
  { status: "loading" } | { status: "ok"; items: Thread[] } | { status: "error"; message: string };

export function useThreads() {
  const [state, setState] = useState<ThreadsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetch("/api/threads", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load threads");
        return threadListResponseSchema.parse(await response.json()).threads;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load threads",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const markRead = useCallback(async (thread: Thread) => {
    if (thread.unreadCount === 0) return;
    const response = await fetch(`/api/threads/${thread.id}/read`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return;
    const updated = threadResponseSchema.parse(await response.json()).thread;
    setState((current) =>
      current.status === "ok"
        ? {
            ...current,
            items: current.items.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }, []);

  return { state, markRead };
}

type MessagesState =
  | { status: "idle" | "loading" }
  | { status: "ok"; items: Message[] }
  | { status: "error"; message: string };

export function useThreadMessages(threadId: string | undefined) {
  const [state, setState] = useState<MessagesState>({ status: "idle" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  useEffect(() => {
    if (!threadId) return setState({ status: "idle" });
    let active = true;
    setState({ status: "loading" });
    fetch(`/api/threads/${threadId}/messages`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load messages");
        return messageListResponseSchema.parse(await response.json()).messages;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load messages",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [threadId]);

  const send = useCallback(
    async (body: string) => {
      if (!threadId) return false;
      setSending(true);
      setSendError(undefined);
      try {
        const response = await fetch(`/api/threads/${threadId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!response.ok) throw new Error("Failed to send message");
        const created = messageResponseSchema.parse(await response.json()).message;
        setState((current) =>
          current.status === "ok" ? { ...current, items: [created, ...current.items] } : current,
        );
        return true;
      } catch {
        setSendError("Failed to send message");
        return false;
      } finally {
        setSending(false);
      }
    },
    [threadId],
  );

  return { state, sending, sendError, send };
}
