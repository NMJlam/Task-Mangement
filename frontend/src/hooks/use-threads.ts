import {
  apiErrorSchema,
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
import { apiErrorMessage } from "@/lib/api-error";

/**
 * How often Messages re-reads while the tab is in front. Conversation is the
 * one page here where other people's writes are the point, so it polls faster
 * than the notification feed does.
 */
const LIST_POLL_MS = 15_000;
const MESSAGE_POLL_MS = 3_000;

type ThreadsState =
  { status: "loading" } | { status: "ok"; items: Thread[] } | { status: "error"; message: string };

/** Newest activity first — the order `GET /api/threads` returns. */
function byActivity(a: Thread, b: Thread): number {
  return (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime();
}

/** The error message a failed response carries, or `fallback`. */
async function failure(response: Response, fallback: string): Promise<string> {
  try {
    return apiErrorMessage(await response.json()) ?? fallback;
  } catch {
    return fallback;
  }
}

export function useThreads() {
  const [state, setState] = useState<ThreadsState>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [deleteError, setDeleteError] = useState<{ threadId: string; message: string }>();
  const [generation, setGeneration] = useState(0);
  // Moves on every local change to the list (a conversation started or deleted
  // here). A read that began before the change is a snapshot from before it:
  // it would drop the new conversation — and the page would take that as the
  // conversation being gone, switching away and wiping its draft — or put a
  // deleted one back. So a read only lands if no change happened while it was
  // in flight.
  const listVersion = useRef(0);
  // Groups deleted here. A deletion is final, so nothing — a late read, a
  // mark-read answer — may bring one back.
  const removed = useRef(new Set<string>());

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const started = listVersion.current;
    fetch("/api/threads", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load threads");
        return threadListResponseSchema.parse(await response.json()).threads;
      })
      .then((items) => {
        if (active && listVersion.current === started) {
          setState({
            status: "ok",
            items: items.filter((item) => !removed.current.has(item.id)),
          });
        }
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
  useRevalidate(reload, { intervalMs: LIST_POLL_MS });

  // Both below only ever REPLACE a thread already in the list — never add one —
  // so a late answer about a deleted group has nothing to land on.
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
  const create = useCallback(
    async (input: CreateThread) => {
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
        // Before the thread goes on screen: any read already in flight is now
        // out of date, and must not land over it.
        listVersion.current += 1;
        setState((current) =>
          current.status === "ok" && !current.items.some((item) => item.id === thread.id)
            ? { ...current, items: [thread, ...current.items] }
            : current,
        );
        // And a fresh read, so the list is the server's again. Until it lands —
        // or if it fails — the thread just confirmed stays where it is.
        reload();
        return thread;
      } catch (cause) {
        setCreateError(cause instanceof Error ? cause.message : "Failed to start the conversation");
        return undefined;
      } finally {
        setCreating(false);
      }
    },
    [reload],
  );

  /** A failed start belongs to that attempt — not to the next time the dialog opens. */
  const clearCreateError = useCallback(() => setCreateError(undefined), []);

  /**
   * Deletes a group for everyone. It leaves the list only once the server has
   * said so: a refusal leaves it — and its draft — exactly where it was. A 404
   * means it is already gone (another member deleted it first), which is the
   * outcome asked for, so it leaves the list the same way.
   */
  const deleteGroup = useCallback(
    async (thread: Thread): Promise<boolean> => {
      setDeletingId(thread.id);
      setDeleteError(undefined);
      try {
        const response = await fetch(`/api/threads/${thread.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(await failure(response, "Failed to delete the group"));
        }
        removed.current.add(thread.id);
        listVersion.current += 1;
        setState((current) =>
          current.status === "ok"
            ? { ...current, items: current.items.filter((item) => item.id !== thread.id) }
            : current,
        );
        reload();
        return true;
      } catch (cause) {
        setDeleteError({
          threadId: thread.id,
          message: cause instanceof Error ? cause.message : "Failed to delete the group",
        });
        return false;
      } finally {
        setDeletingId((current) => (current === thread.id ? undefined : current));
      }
    },
    [reload],
  );

  const clearDeleteError = useCallback(() => setDeleteError(undefined), []);

  return {
    state,
    reload,
    markRead,
    noteActivity,
    create,
    creating,
    createError,
    clearCreateError,
    deleteGroup,
    deletingId,
    deleteError,
    clearDeleteError,
  };
}

type MessagesState =
  | { status: "idle" | "loading" }
  | { status: "ok"; items: Message[]; nextCursor: string | null }
  | { status: "error"; message: string }
  // The server no longer shows this thread to the reader — deleted, or their
  // access gone. Unlike an error, retrying will not bring it back.
  | { status: "gone" };

/** Preserve the server's sequence when JS Date rounds distinct DB timestamps
 * to the same millisecond. Re-sorting those by id could move the history floor. */
function newestFirst(a: Message, b: Message): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
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

/**
 * How far back one refresh reads — 500 messages at the API's default page.
 * Past that it shows the newest stretch alone and lets "Load older" page back,
 * rather than walking a thread's whole history on a timer.
 */
const MAX_REFRESH_PAGES = 10;

function messagesUrl(threadId: string, query: string, before?: string): string {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (query.trim()) params.set("q", query.trim());
  const search = params.toString();
  return `/api/threads/${threadId}/messages${search ? `?${search}` : ""}`;
}

/** A read the server refused because the thread is not there for this reader. */
class ThreadGoneError extends Error {}

/** One page of messages, or `ThreadGoneError` on a 404. */
async function readPage(url: string, fallback: string) {
  const response = await fetch(url, { credentials: "include" });
  if (response.status === 404) throw new ThreadGoneError();
  if (!response.ok) throw new Error(fallback);
  return messageListResponseSchema.parse(await response.json());
}

/**
 * One thread's messages: the newest page, older pages on request, sends and
 * deletions.
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
 *
 * `onGone` hears when the server answers 404 for the thread on screen: it was
 * deleted, or the reader can no longer see it. Its messages are cleared then,
 * not kept on screen as if they were still there.
 */
export function useThreadMessages(
  threadId: string | undefined,
  query = "",
  { onGone }: { onGone?: (threadId: string) => void } = {},
) {
  const [state, setState] = useState<MessagesState>({ status: "idle" });
  // Sends in flight per thread, so a slow send in one never shows "Sending…"
  // in the next, and two threads' sends cannot clear each other's state.
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({});
  const [sendError, setSendError] = useState<{ threadId: string; message: string }>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();
  // Per message, so deleting one never shows another as deleting, and a
  // failure stays on the message it belongs to until it is retried.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const [deleteErrors, setDeleteErrors] = useState<Readonly<Record<string, string>>>({});

  // Which conversation is on screen, for work that lands late to check. The
  // generation moves on every switch, so leaving a thread and coming back is a
  // different visit from the one a slow send started in. A new search does not
  // move it: it filters the same conversation.
  const shown = useRef<{ threadId: string | undefined; generation: number }>({
    threadId,
    generation: 0,
  });
  const searched = useRef(query);
  // Which history is on screen. It moves whenever the held messages are
  // replaced wholesale — a new thread, a new search, a return visit, or a
  // refresh that could not cover what was held — and every read that pages (a
  // refresh, a "Load older") checks it before touching state, so a page
  // fetched for one history never lands in, or clears the loading state of,
  // another.
  const epoch = useRef(0);
  // Messages this browser sent and put on screen itself. They are the newest
  // held, but others may have arrived just before them unseen, so a refresh
  // does not count them as part of the stretch it has to cover.
  const unsynced = useRef(new Set<string>());
  // Every message known to be deleted, as its tombstone. A deletion is final,
  // so a tombstone always wins over a live copy of the same message — which is
  // what a read that started before the deletion brings back.
  const tombstones = useRef(new Map<string, Message>());
  // The history a catch-up is running for, if one is.
  const catchingUp = useRef<number | undefined>(undefined);
  const latest = useRef(state);
  const goneHandler = useRef(onGone);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    goneHandler.current = onGone;
  }, [onGone]);

  useEffect(() => {
    if (shown.current.threadId !== threadId) {
      shown.current = { threadId, generation: shown.current.generation + 1 };
    }
    setSendError(undefined);
  }, [threadId]);

  useEffect(() => {
    searched.current = query;
  }, [query]);

  /**
   * `items` as they may be shown: what the server says is deleted is
   * remembered, what this browser knows is deleted wins over a live copy, and a
   * search shows no deleted message at all — its words are what it matched.
   */
  const settled = useCallback((items: readonly Message[], term: string): Message[] => {
    const searching = term.trim() !== "";
    const kept: Message[] = [];
    for (const item of items) {
      if (item.deletedAt) tombstones.current.set(item.id, item);
      const tombstone = tombstones.current.get(item.id);
      if (tombstone && searching) continue;
      kept.push(tombstone ?? item);
    }
    return kept;
  }, []);

  /** The thread on screen answered 404: clear it, and tell the page. */
  const markGone = useCallback((gone: string) => {
    if (shown.current.threadId !== gone) return;
    epoch.current += 1;
    unsynced.current.clear();
    setLoadingOlder(false);
    setOlderError(undefined);
    setState({ status: "gone" });
    goneHandler.current?.(gone);
  }, []);

  useEffect(() => {
    epoch.current += 1;
    unsynced.current.clear();
    setLoadingOlder(false);
    setOlderError(undefined);
    if (!threadId) return setState({ status: "idle" });
    let active = true;
    setState({ status: "loading" });
    readPage(messagesUrl(threadId, query), "Failed to load messages")
      .then((page) => {
        if (active) {
          setState({
            status: "ok",
            items: settled(page.messages, query),
            nextCursor: page.nextCursor,
          });
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ThreadGoneError) {
          markGone(threadId);
          return;
        }
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : "Failed to load messages",
        });
      });
    return () => {
      active = false;
    };
  }, [threadId, query, settled, markGone]);

  /**
   * Brings what is on screen up to date with the server: new messages, and
   * messages deleted since — anywhere in what is held, not just the newest
   * page.
   *
   * So it re-reads the whole stretch held, newest page first, down to the
   * oldest message held that a read has also seen (the floor), and puts the
   * server's answer in place of what was held over that stretch. A message the
   * server now shows as deleted comes back as its tombstone; a search hit it no
   * longer returns goes. Older pages "Load older" added while this ran stay,
   * with their cursor.
   *
   * A tab left in the background can fall behind by more than the page budget
   * covers, and a page can fail. Either way the newest stretch that WAS read is
   * shown on its own with its own cursor, rather than two stretches with a hole
   * between them; "Load older" carries on from there.
   */
  const refresh = useCallback(async () => {
    const start = epoch.current;
    // One catch-up per history at a time: a focus and a poll firing together
    // would otherwise both fetch, and the later to land could overwrite the
    // other's result with an older read.
    if (catchingUp.current === start) return;
    catchingUp.current = start;
    try {
      await catchUp();
    } finally {
      if (catchingUp.current === start) catchingUp.current = undefined;
    }

    async function catchUp(): Promise<void> {
      const id = shown.current.threadId;
      const term = searched.current;
      if (!id) return;
      const held = latest.current;
      if (held.status === "gone") return;
      const floor =
        held.status === "ok"
          ? held.items.filter((item) => !unsynced.current.has(item.id)).at(-1)
          : undefined;

      const heldIds = new Set(held.status === "ok" ? held.items.map((item) => item.id) : []);
      const fetched: Message[] = [];
      let before: string | undefined;
      let nextCursor: string | null = null;
      // Read down to the floor, or the start of the thread.
      let covered = false;
      for (let page = 0; page < MAX_REFRESH_PAGES; page += 1) {
        let result: { messages: Message[]; nextCursor: string | null };
        try {
          result = await readPage(messagesUrl(id, term, before), "Failed to refresh messages");
        } catch (cause) {
          if (epoch.current !== start) return;
          if (cause instanceof ThreadGoneError) {
            markGone(id);
            return;
          }
          // Nothing new yet: what is on screen stands until the next try.
          if (fetched.length === 0) return;
          // Part of the way: "Load older" retries the page that failed.
          nextCursor = before ?? null;
          break;
        }
        if (epoch.current !== start) return;
        fetched.push(...result.messages);
        nextCursor = result.nextCursor;
        if (
          !floor ||
          result.nextCursor === null ||
          result.messages.some((message) => message.id === floor.id)
        ) {
          covered = true;
          break;
        }
        before = result.nextCursor;
      }
      if (epoch.current !== start) return;

      const fetchedById = new Map(fetched.map((message) => [message.id, message]));
      // React may run the state updater after the fetched IDs are marked synced.
      const pendingAtCommit = new Set(unsynced.current);
      // Keep pending local sends, including one the read found below its floor.
      // Prefer the refreshed representation when present, so a server tombstone
      // cannot be overwritten by the locally held live copy.
      const sentMeanwhile = (items: readonly Message[]) =>
        items
          .filter((item) => pendingAtCommit.has(item.id))
          .map((item) => fetchedById.get(item.id) ?? item);

      if (covered) {
        const reachedFloor = floor !== undefined && nextCursor !== null;
        setState((current) => {
          if (current.status !== "ok" && current.status !== "error") return current;
          const now = current.status === "ok" ? current.items : [];
          if (reachedFloor) {
            // The stretch down to the floor is the server's now. Below it,
            // whatever is held stays — "Load older" may have added to it.
            // Use the server's sequence, not rounded JS timestamps. Pages
            // loaded meanwhile retain their boundary, with refreshed versions
            // substituted where the refresh overlaps those older records.
            const floorIndex = fetched.findIndex((message) => message.id === floor.id);
            const atOrAbove = fetched.slice(0, floorIndex + 1);
            const refreshed = new Map(fetched.map((message) => [message.id, message]));
            const below = now
              .filter((item) => !heldIds.has(item.id) && !unsynced.current.has(item.id))
              .map((item) => refreshed.get(item.id) ?? item);
            return {
              status: "ok",
              items: settled(merge([...atOrAbove, ...below], sentMeanwhile(now)), term),
              nextCursor: current.status === "ok" ? current.nextCursor : nextCursor,
            };
          }
          // Read the whole thread, or there was nothing to cover: the server's
          // answer is all there is.
          return {
            status: "ok",
            items: settled(merge(fetched, sentMeanwhile(now)), term),
            nextCursor,
          };
        });
      } else {
        // Replacing the history: a "Load older" in flight belongs to the old one.
        epoch.current += 1;
        setLoadingOlder(false);
        setOlderError(undefined);
        setState((current) =>
          current.status === "ok" || current.status === "error"
            ? {
                status: "ok",
                items: settled(
                  merge(sentMeanwhile(current.status === "ok" ? current.items : []), fetched),
                  term,
                ),
                nextCursor,
              }
            : current,
        );
      }
      // Only what this read saw: a message sent while it ran is still unsynced.
      for (const message of fetched) unsynced.current.delete(message.id);
    }
  }, [settled, markGone]);

  const revalidate = useCallback(() => void refresh(), [refresh]);
  useRevalidate(revalidate, { intervalMs: MESSAGE_POLL_MS, enabled: threadId !== undefined });

  /**
   * The page below the oldest held message. Its success, its error and its
   * loading flag all belong to the history it was asked for: once the reader
   * switches thread or search, or a refresh replaces the history, it lands
   * nowhere and clears nothing, so the next view can page on its own.
   */
  const loadOlder = useCallback(async () => {
    if (!threadId || state.status !== "ok" || state.nextCursor === null || loadingOlder) return;
    const start = epoch.current;
    const before = state.nextCursor;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const page = await readPage(
        messagesUrl(threadId, query, before),
        "Failed to load older messages",
      );
      if (epoch.current !== start) return;
      setState((current) =>
        current.status === "ok"
          ? {
              status: "ok",
              items: settled(merge(current.items, page.messages), query),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (cause) {
      if (epoch.current !== start) return;
      if (cause instanceof ThreadGoneError) {
        markGone(threadId);
        return;
      }
      setOlderError(cause instanceof Error ? cause.message : "Failed to load older messages");
    } finally {
      if (epoch.current === start) setLoadingOlder(false);
    }
  }, [threadId, query, state, loadingOlder, settled, markGone]);

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
        if (response.status === 404) {
          markGone(threadId);
          return undefined;
        }
        if (!response.ok) {
          const reason = await failure(response, "Failed to send message");
          if (stillHere()) setSendError({ threadId, message: reason });
          return undefined;
        }
        const created = messageResponseSchema.parse(await response.json()).message;
        // Into the list only while its own thread is on screen, and only if
        // the search being shown would have found it.
        const accepted = tombstones.current.get(created.id) ?? created;
        if (shown.current.threadId === threadId && matchesSearch(accepted, searched.current)) {
          if (!accepted.deletedAt) unsynced.current.add(accepted.id);
          setState((current) =>
            current.status === "ok"
              ? { ...current, items: settled(merge([accepted], current.items), searched.current) }
              : current,
          );
        }
        return stillHere() ? accepted : undefined;
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
    [threadId, markGone, settled],
  );

  /**
   * Deletes one message for everyone. Nothing changes on screen until the
   * server agrees: then the message becomes its tombstone (or, in a search,
   * leaves the results). A refusal leaves it as it was, with the reason, to
   * retry. Resolves to the tombstone, or `undefined`.
   */
  const deleteMessage = useCallback(
    async (message: Message): Promise<Message | undefined> => {
      const id = message.id;
      setDeleting((current) => new Set(current).add(id));
      setDeleteErrors(({ [id]: _cleared, ...rest }) => rest);
      try {
        const response = await fetch(`/api/threads/${message.channelId}/messages/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => undefined);
          const parsed = apiErrorSchema.safeParse(body);
          if (
            response.status === 404 &&
            parsed.success &&
            parsed.data.error.code === "THREAD_NOT_FOUND"
          ) {
            markGone(message.channelId);
            return undefined;
          }
          throw new Error(apiErrorMessage(body) ?? "Failed to delete the message");
        }
        const tombstone = messageResponseSchema.parse(await response.json()).message;
        tombstones.current.set(tombstone.id, tombstone);
        if (shown.current.threadId === tombstone.channelId) {
          setState((current) =>
            current.status === "ok"
              ? { ...current, items: settled(current.items, searched.current) }
              : current,
          );
        }
        return tombstone;
      } catch (cause) {
        setDeleteErrors((current) => ({
          ...current,
          [id]: cause instanceof Error ? cause.message : "Failed to delete the message",
        }));
        return undefined;
      } finally {
        setDeleting((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [settled, markGone],
  );

  const clearDeleteError = useCallback(
    (messageId: string) => setDeleteErrors(({ [messageId]: _cleared, ...rest }) => rest),
    [],
  );

  return {
    state,
    sending: threadId !== undefined && (pending[threadId] ?? 0) > 0,
    sendError: sendError && sendError.threadId === threadId ? sendError.message : undefined,
    send,
    loadOlder,
    loadingOlder,
    olderError,
    deleteMessage,
    deleting,
    deleteErrors,
    clearDeleteError,
  };
}
