import {
  messageListResponseSchema,
  messageResponseSchema,
  threadListResponseSchema,
  threadResponseSchema,
  type CreateThread,
  type Message,
  type Thread,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type ThreadsState =
  { status: "loading" } | { status: "ok"; items: Thread[] } | { status: "error"; message: string };

export function useThreads() {
  const [state, setState] = useState<ThreadsState>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

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

  /**
   * Starts a dm or group. A dm that already exists comes back `200`, not
   * `201`, but either way the thread returned is the one to switch to — the
   * caller does not need to tell the two apart.
   */
  const create = useCallback(async (input: CreateThread) => {
    setCreating(true);
    setCreateError(undefined);
    try {
      const response = await fetch("/api/threads", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Failed to start the conversation");
      const thread = threadResponseSchema.parse(await response.json()).thread;
      setState((current) =>
        current.status === "ok" && !current.items.some((item) => item.id === thread.id)
          ? { ...current, items: [thread, ...current.items] }
          : current,
      );
      return thread;
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Failed to start the conversation");
      return undefined;
    } finally {
      setCreating(false);
    }
  }, []);

  return { state, markRead, create, creating, createError };
}

type MessagesState =
  | { status: "idle" | "loading" }
  | { status: "ok"; items: Message[] }
  | { status: "error"; message: string };

/**
 * `query` is the caller's job to debounce — this hook just refetches
 * whenever it changes, the same way it already refetches on `threadId`.
 * Keyword search is server-side (`?q=`), not a client-side filter: the page
 * only ever holds the one loaded page of messages, and a thread can hold far
 * more than that.
 */
export function useThreadMessages(threadId: string | undefined, query = "") {
  const [state, setState] = useState<MessagesState>({ status: "idle" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  useEffect(() => {
    if (!threadId) return setState({ status: "idle" });
    let active = true;
    setState({ status: "loading" });
    const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    fetch(`/api/threads/${threadId}/messages${params}`, { credentials: "include" })
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
  }, [threadId, query]);

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
