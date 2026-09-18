import {
  taskListResponseSchema,
  taskResponseSchema,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type TasksState =
  { status: "loading" } | { status: "ok"; items: Task[] } | { status: "error"; message: string };

export function useTasks() {
  const [state, setState] = useState<TasksState>({ status: "loading" });
  const [busy, setBusy] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch("/api/tasks", { credentials: "include" })
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
  }, []);

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

  const changeStatus = useCallback(async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    setBusy(task.id);
    setMutationError(undefined);
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
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to update task");
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { state, busy, mutationError, createTask, changeStatus };
}
