import {
  messageListResponseSchema,
  messageResponseSchema,
  threadListResponseSchema,
  threadResponseSchema,
  type CreateThread,
  type Message,
  type Thread,
} from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";

/**
 * How often Messages re-reads while the tab is in front. Conversation is the
 * one page here where other people's writes are the point, so it polls faster
 * than the notification feed does.
 */
const POLL_MS = 15_000;

type ThreadsState =
  { status: "loading" } | { status: "ok"; items: Thread[] } | { status: "error"; message: string };

/** Newest activity first — the order `GET /api/threads` returns. */
function byActivity(a: Thread, b: Thread): number {
  return (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime();
}

export function useThreads() {
  const [state, setState] = useState<ThreadsState>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

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
          // A refresh that fails must not take away a list the reader can still
          // use — only a cold load has nothing to keep.
          setState((current) =>
            current.status === "ok"
              ? current
              : {
                  status: "error",
                  message: cause instanceof Error ? cause.message : "Failed to load threads",
                },
          );
        }
      });
    return () => {
      active = false;
    };
  }, [generation]);

  // New threads, new messages elsewhere and unread counts arrive without the
  // reader doing anything, so the list re-reads on a timer and on return.
  useRevalidate(reload, { intervalMs: POLL_MS });

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
   * A message the reader just sent moves its conversation to the top, as the
   * next read would — without waiting for it.
   */
  const noteActivity = useCallback((message: Message) => {
    setState((current) =>
      current.status === "ok"
        ? {
            ...current,
            items: current.items
              .map((item) =>
                item.id === message.channelId
                  ? { ...item, lastMessageAt: message.createdAt }
                  : item,
              )
              .sort(byActivity),
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

  /** A failed start belongs to that attempt — not to the next time the dialog opens. */
  const clearCreateError = useCallback(() => setCreateError(undefined), []);

  return { state, markRead, noteActivity, create, creating, createError, clearCreateError };
}

type MessagesState =
  | { status: "idle" | "loading" }
  | { status: "ok"; items: Message[]; nextCursor: string | null }
  | { status: "error"; message: string };

/** Newest first, as the API pages them: `created_at`, then id. */
function newestFirst(a: Message, b: Message): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** `held` with `incoming` folded in, once each, newest first. */
function merge(held: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map(held.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(newestFirst);
}

/** The client's reading of the route's `?q=`: a case-insensitive substring. */
function matchesSearch(message: Message, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle === "" || message.body.toLocaleLowerCase().includes(needle);
}

function messagesUrl(threadId: string, query: string, before?: string): string {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (query.trim()) params.set("q", query.trim());
  const search = params.toString();
  return `/api/threads/${threadId}/messages${search ? `?${search}` : ""}`;
}

/**
 * One thread's messages: the newest page, older pages on request, and sends.
 *
 * `query` is the caller's job to debounce — this hook just refetches whenever
 * it changes, the same way it refetches on `threadId`. Keyword search is
 * server-side (`?q=`), not a client-side filter: the page only ever holds the
 * pages it has loaded, and a thread can hold far more than that.
 *
 * The reader can switch threads while a request is in flight, so everything
 * that lands late checks which conversation is on screen first. A send from a
 * thread the reader has left never writes into the one they are now reading —
 * not its messages, its error, its "Sending…" state or its draft.
 */
export function useThreadMessages(threadId: string | undefined, query = "") {
  const [state, setState] = useState<MessagesState>({ status: "idle" });
  // Sends in flight per thread, so a slow send in one never shows "Sending…"
  // in the next, and two threads' sends cannot clear each other's state.
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({});
  const [sendError, setSendError] = useState<{ threadId: string; message: string }>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();

  // Which conversation is on screen, for work that lands late to check. The
  // generation moves on every switch, so leaving a thread and coming back is a
  // different visit from the one a slow send started in. A new search does not
  // move it: it filters the same conversation.
  const shown = useRef<{ threadId: string | undefined; generation: number }>({
    threadId,
    generation: 0,
  });
  const searched = useRef(query);

  useEffect(() => {
    if (shown.current.threadId !== threadId) {
      shown.current = { threadId, generation: shown.current.generation + 1 };
    }
    setSendError(undefined);
    setOlderError(undefined);
  }, [threadId]);

  useEffect(() => {
    searched.current = query;
  }, [query]);

  useEffect(() => {
    if (!threadId) return setState({ status: "idle" });
    let active = true;
    setState({ status: "loading" });
    fetch(messagesUrl(threadId, query), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load messages");
        return messageListResponseSchema.parse(await response.json());
      })
      .then((page) => {
        if (active) setState({ status: "ok", items: page.messages, nextCursor: page.nextCursor });
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

  /**
   * Re-reads the newest page and folds it into what is held, so pages already
   * loaded with "Load older" stay put. At club volume a poll never misses a
   * page's worth of messages in one interval.
   */
  const refresh = useCallback(async () => {
    const id = shown.current.threadId;
    const term = searched.current;
    if (!id) return;
    try {
      const response = await fetch(messagesUrl(id, term), { credentials: "include" });
      if (!response.ok) return;
      const page = messageListResponseSchema.parse(await response.json());
      if (shown.current.threadId !== id || searched.current !== term) return;
      setState((current) => {
        if (current.status === "ok")
          return { ...current, items: merge(current.items, page.messages) };
        // A refresh is also how a failed load recovers on its own.
        if (current.status === "error") {
          return { status: "ok", items: page.messages, nextCursor: page.nextCursor };
        }
        return current;
      });
    } catch {
      // Whatever is on screen is still the best answer until the next try.
    }
  }, []);

  const revalidate = useCallback(() => void refresh(), [refresh]);
  useRevalidate(revalidate, { intervalMs: POLL_MS, enabled: threadId !== undefined });

  const loadOlder = useCallback(async () => {
    if (state.status !== "ok" || state.nextCursor === null || loadingOlder) return;
    const id = shown.current.threadId;
    const term = searched.current;
    const before = state.nextCursor;
    if (!id) return;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const response = await fetch(messagesUrl(id, term, before), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load older messages");
      const page = messageListResponseSchema.parse(await response.json());
      if (shown.current.threadId !== id || searched.current !== term) return;
      setState((current) =>
        current.status === "ok"
          ? {
              status: "ok",
              items: merge(current.items, page.messages),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (cause) {
      if (shown.current.threadId === id) {
        setOlderError(cause instanceof Error ? cause.message : "Failed to load older messages");
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [state, loadingOlder]);

  /**
   * Resolves to the created message while the reader is still on the visit it
   * was sent from — the caller's cue to clear its draft — and `undefined`
   * otherwise, including after leaving and coming back, where the draft in the
   * box is a new one.
   */
  const send = useCallback(
    async (body: string): Promise<Message | undefined> => {
      if (!threadId) return undefined;
      const visit = shown.current.generation;
      const stillHere = () =>
        shown.current.threadId === threadId && shown.current.generation === visit;

      setPending((current) => ({ ...current, [threadId]: (current[threadId] ?? 0) + 1 }));
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
        // Into the list only while its own thread is on screen, and only if
        // the search being shown would have found it.
        if (shown.current.threadId === threadId && matchesSearch(created, searched.current)) {
          setState((current) =>
            current.status === "ok"
              ? { ...current, items: merge(current.items, [created]) }
              : current,
          );
        }
        return stillHere() ? created : undefined;
      } catch {
        if (stillHere()) setSendError({ threadId, message: "Failed to send message" });
        return undefined;
      } finally {
        setPending((current) => {
          const left = (current[threadId] ?? 1) - 1;
          const { [threadId]: _done, ...rest } = current;
          return left > 0 ? { ...rest, [threadId]: left } : rest;
        });
      }
    },
    [threadId],
  );

  return {
    state,
    sending: threadId !== undefined && (pending[threadId] ?? 0) > 0,
    sendError: sendError && sendError.threadId === threadId ? sendError.message : undefined,
    send,
    loadOlder,
    loadingOlder,
    olderError,
  };
}
