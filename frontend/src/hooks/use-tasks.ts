import {
  taskListResponseSchema,
  taskResponseSchema,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTask,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type TasksState =
  { status: "loading" } | { status: "ok"; items: Task[] } | { status: "error"; message: string };

/**
 * ViewModel for a task board. With no `eventId` it reads the whole `/api/tasks`
 * list (the `/tasks` board); with one it reads that event's tasks alone.
 *
 * `enabled: false` keeps the hook idle — `event-detail` calls it above its early
 * returns, where the route param may still be missing, and an idle hook must
 * never fall back to the global list.
 */
export function useTasks({
  eventId,
  enabled = true,
}: { eventId?: string; enabled?: boolean } = {}) {
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
    const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";

    fetch(`/api/tasks${query}`, { credentials: "include" })
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
  }, [enabled, eventId]);

  const createTask = useCallback(async (title: string, priority: TaskPriority) => {
    setBusy("new");
    setMutationError(undefined);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, priority }),
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

  return { state, busy, mutationError, createTask, changeStatus, changeEvent, updateTask };
}
