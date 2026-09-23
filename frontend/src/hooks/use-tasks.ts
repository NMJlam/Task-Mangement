import {
  taskListResponseSchema,
  taskResponseSchema,
  type CreateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTask,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type TasksState =
  { status: "loading" } | { status: "ok"; items: Task[] } | { status: "error"; message: string };

/**
 * What narrows the board. Every field is a server-side filter on the same
 * endpoints the API already exposes, so a filtered board is a read of the whole
 * set rather than a view over the capped page the client happens to hold —
 * which is the difference between "no urgent tasks" and "no urgent tasks on the
 * page I was given".
 */
export type TasksQuery = {
  eventId?: string;
  /** Membership, not identity: a multi-assignee task matches for each holder. */
  assignee?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  /**
   * Switches the read to `/api/tasks/overdue`, where overdue is derived
   * (`due_at < now() AND status <> 'done'`) and `status` therefore has no
   * meaning — the endpoint defines the status filter itself.
   */
  overdue?: boolean;
  /**
   * `enabled: false` keeps the hook idle — `event-detail` calls it above its
   * early returns, where the route param may still be missing, and an idle hook
   * must never fall back to the global list. The dashboard uses it to wait for
   * the caller's own id before asking for their tasks.
   */
  enabled?: boolean;
};

/**
 * ViewModel for a task board. With no filter it reads the whole `/api/tasks`
 * list (the `/tasks` board); with an `eventId` it reads that event's tasks
 * alone; every other option narrows the same read.
 */
export function useTasks({
  eventId,
  assignee,
  status,
  priority,
  overdue = false,
  enabled = true,
}: TasksQuery = {}) {
  const [state, setState] = useState<TasksState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    if (!enabled) {
      setState({ status: "loading" });
      setBusy(undefined);
      setMutationError(undefined);
      return;
    }

    let active = true;
    setState({ status: "loading" });

    const params = new URLSearchParams();
    if (eventId) params.set("eventId", eventId);
    if (assignee) params.set("assignee", assignee);
    if (priority) params.set("priority", priority);
    // The overdue read owns its own status rule, so sending one would be a
    // contradiction rather than a further narrowing.
    if (status && !overdue) params.set("status", status);
    const search = params.toString();
    const url = `/api/tasks${overdue ? "/overdue" : ""}${search ? `?${search}` : ""}`;

    fetch(url, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load tasks");
        return taskListResponseSchema.parse(await response.json()).tasks;
      })
      .then((items) => {
        if (active) setState({ status: "ok", items });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load tasks",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [enabled, eventId, assignee, status, priority, overdue]);

  const createTask = useCallback(async (input: CreateTask) => {
    setBusy("new");
    setMutationError(undefined);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Failed to create task");
      const created = taskResponseSchema.parse(await response.json()).task;
      setState((current) =>
        current.status === "ok" ? { ...current, items: [created, ...current.items] } : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to create task");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  const updateTask = useCallback(async (task: Task, patch: UpdateTask) => {
    setBusy(task.id);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Failed to update task");
      const updated = taskResponseSchema.parse(await response.json()).task;
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to update task");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  /**
   * Optimistic, because the drop has already moved the card: the board commits
   * the new column immediately and the write either confirms it with the
   * server's row or puts the original task back and surfaces the error.
   */
  const changeStatus = useCallback(async (task: Task, status: TaskStatus) => {
    if (task.status === status) return true;
    setBusy(task.id);
    setMutationError(undefined);
    setState((current) =>
      current.status === "ok"
        ? {
            ...current,
            items: current.items.map((item) => (item.id === task.id ? { ...item, status } : item)),
          }
        : current,
    );
    try {
      const response = await fetch(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      const updated = taskResponseSchema.parse(await response.json()).task;
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      return true;
    } catch (cause) {
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => (item.id === task.id ? task : item)),
            }
          : current,
      );
      setMutationError(cause instanceof Error ? cause.message : "Failed to update task");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  const changeEvent = useCallback(async (task: Task, eventId: string | null) => {
    if (task.eventId === eventId) return;
    setBusy(task.id);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!response.ok) throw new Error("Failed to link task");
      const updated = taskResponseSchema.parse(await response.json()).task;
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to link task");
    } finally {
      setBusy(undefined);
    }
  }, []);

  /**
   * Not optimistic, unlike `changeStatus`: nothing has moved on screen yet, so
   * there is no gesture to keep in step — and a card that vanished and then
   * reappeared would be a worse answer than a moment's wait. The server's
   * `authorise(1)` is the real gate; callers hide the control to match.
   */
  const deleteTask = useCallback(async (task: Task) => {
    setBusy(task.id);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      // 204: no body to read, so the local list IS the record of the delete.
      if (!response.ok) throw new Error("Failed to delete task");
      setState((current) =>
        current.status === "ok"
          ? { ...current, items: current.items.filter((item) => item.id !== task.id) }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to delete task");
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  return {
    state,
    busy,
    mutationError,
    createTask,
    changeStatus,
    changeEvent,
    updateTask,
    deleteTask,
  };
}
