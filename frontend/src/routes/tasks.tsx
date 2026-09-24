import {
  listTasksQuerySchema,
  taskPrioritySchema,
  taskStatusSchema,
  type EventSummary,
} from "@ctp/shared";
import { ListPlus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { statusStyles } from "@/components/common/status-badge";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import {
  TaskFilters,
  defaultTaskFilters,
  isFiltered,
  type TaskFilterState,
} from "@/components/tasks/task-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/hooks/use-events";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useTasks } from "@/hooks/use-tasks";

/**
 * The filter state a URL carries. Every key is optional and every default is
 * omitted, so `/?` — the bare `/tasks` — is the canonical unfiltered board, and
 * a value that no longer parses falls back to its default instead of leaving
 * the page in a filter the reader cannot clear.
 */
function readFilters(params: URLSearchParams): TaskFilterState {
  const status = taskStatusSchema.safeParse(params.get("status"));
  const priority = taskPrioritySchema.safeParse(params.get("priority"));
  // The event id is validated against the SAME schema the route validates the
  // query with, so an id that cannot reach the API never becomes a query.
  const event = listTasksQuerySchema.shape.eventId.safeParse(params.get("event"));
  return {
    scope: params.get("scope") === "mine" ? "mine" : "all",
    status: status.success ? status.data : "",
    priority: priority.success ? priority.data : "",
    event: event.success && event.data ? event.data : "",
    overdue: params.get("overdue") === "true",
  };
}

/** The filters in the reader's own words, for the empty state. */
function describeFilters(filters: TaskFilterState, query: string, events?: EventSummary[]) {
  const parts: string[] = [];
  if (filters.scope === "mine") parts.push("assigned to you");
  if (filters.overdue) parts.push("overdue");
  if (filters.status) parts.push(statusStyles[filters.status].label);
  if (filters.priority) parts.push(`${filters.priority} priority`);
  if (filters.event) {
    parts.push(events?.find((event) => event.id === filters.event)?.title ?? "the chosen event");
  }
  if (query.trim()) parts.push(`matching “${query.trim()}”`);
  return parts.join(", ");
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const query = searchParams.get("q") ?? "";
  const me = useMe();
  const events = useEvents();
  // The roster is one club-sized page, so the assignment editor searches it in
  // memory rather than asking the server for matches (see dashboard-search.tsx).
  const members = useMembers();
  // "Mine" is a server filter on the caller's own id, so it cannot be issued
  // before `/api/me` answers. `enabled` holds the read rather than letting it
  // fall back to the unfiltered list, which would answer a different question.
  const needsIdentity = filters.scope === "mine";
  const identityReady = me.status === "ok";
  const tasks = useTasks({
    // Only "My Tasks" narrows by the caller; "All Tasks" must read the club's
    // whole board.
    assignee: needsIdentity && identityReady ? me.user.id : undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    eventId: filters.event || undefined,
    overdue: filters.overdue,
    enabled: !needsIdentity || identityReady,
  });
  const [adding, setAdding] = useState(false);
  const taskItems = tasks.state.status === "ok" ? tasks.state.items : [];
  const eventItems = events.state.status === "ok" ? events.state.items : undefined;
  const memberItems = members.state.status === "ok" ? members.state.items : [];

  // Search stays client-side over the server-filtered result: the filters are
  // the query, and a title search is a further narrowing of what came back.
  const needle = query.trim().toLocaleLowerCase();
  const visibleTasks = needle
    ? taskItems.filter((task) => task.title.toLocaleLowerCase().includes(needle))
    : taskItems;
  const filtersActive = isFiltered(filters) || needle !== "";

  /**
   * Rewrites the URL from the whole filter state, not from the parameter that
   * changed: defaults are dropped, so there is exactly one URL per view and a
   * stale key cannot survive the next interaction.
   */
  function writeParams(next: TaskFilterState, nextQuery: string, replace = false) {
    const params = new URLSearchParams();
    if (next.scope !== defaultTaskFilters.scope) params.set("scope", next.scope);
    if (next.status) params.set("status", next.status);
    if (next.priority) params.set("priority", next.priority);
    if (next.event) params.set("event", next.event);
    if (next.overdue) params.set("overdue", "true");
    // The raw text, not a trimmed copy: the search box is controlled by this
    // value, and trimming it here would swallow a space mid-word and stack the
    // next keystroke onto the wrong string.
    if (nextQuery !== "") params.set("q", nextQuery);
    setSearchParams(params, { replace });
  }

  function updateFilters(patch: Partial<TaskFilterState>) {
    const next = { ...filters, ...patch };
    // Overdue IS `status <> 'done'` server-side, so ticking the box drops the
    // status filter rather than sending two contradictory parameters.
    if (patch.overdue === true) next.status = "";
    writeParams(next, query);
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Tasks"
        description="Keep club work moving from first action to final handoff."
        actions={
          <>
            <div className="relative w-full sm:w-56">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Label htmlFor="task-search" className="sr-only">
                Search tasks
              </Label>
              <Input
                id="task-search"
                name="task-search"
                type="search"
                value={query}
                // Typing replaces rather than pushes: one history entry per
                // keystroke would bury the page the reader came from.
                onChange={(event) => writeParams(filters, event.target.value, true)}
                placeholder="Search tasks"
                autoComplete="off"
                spellCheck={false}
                className="pl-8"
              />
            </div>
            <Button onClick={() => setAdding(true)}>
              <ListPlus aria-hidden="true" />
              Add Tasks
            </Button>
          </>
        }
      />

      <TaskFilters
        filters={filters}
        events={eventItems}
        onScopeChange={(scope) => updateFilters({ scope })}
        onStatusChange={(status) => updateFilters({ status })}
        onPriorityChange={(priority) => updateFilters({ priority })}
        onEventChange={(event) => updateFilters({ event })}
        onOverdueChange={(overdue) => updateFilters({ overdue })}
        onClear={() => writeParams(defaultTaskFilters, "")}
      />

      {/* The create form lives with the board so both pages that own a board —
          this one and an event's Tasks tab — open the same dialog and the same
          draft rules. */}
      <TaskCreateDialog
        open={adding}
        onOpenChange={setAdding}
        events={eventItems}
        members={memberItems}
        // Only "new" is the create dialog's own write, so a card being moved on
        // the board behind it must not disable the form.
        busy={tasks.busy === "new"}
        error={tasks.mutationError}
        onCreate={tasks.createTask}
      />

      {/* While the dialog is open the same message is repeated inside it, so the
          page only announces board failures (drag, assign, edit) on its own. */}
      {tasks.mutationError && !adding && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {tasks.mutationError}. Try again.
        </p>
      )}
      {/* A `scope=mine` read needs the caller's id, so an identity failure is
          its own state rather than a board that waits for a request that can
          never be issued. */}
      {needsIdentity && !identityReady && me.status !== "loading" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load your membership, so your tasks can&apos;t be listed.{" "}
          <Link to="/tasks" className="underline">
            Show all tasks
          </Link>
          .
        </p>
      )}
      {tasks.state.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Tasks…
        </p>
      )}
      {tasks.state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load tasks: {tasks.state.message}. Refresh the page to try again.
        </p>
      )}
      {tasks.state.status === "ok" && (
        <section aria-label="Task board" className="mt-8">
          {/* Filtering swaps the cards with no other cue, so the count is
              announced. Only rendered while a filter is active, which keeps
              "42 tasks" out of the tab order on an unfiltered board. */}
          {filtersActive && (
            <p className="sr-only" role="status">
              {visibleTasks.length === 1
                ? "1 task matches the current filters."
                : `${visibleTasks.length} tasks match the current filters.`}
            </p>
          )}
          <TaskBoard
            tasks={visibleTasks}
            members={memberItems}
            events={eventItems}
            busyId={tasks.busy}
            error={tasks.mutationError}
            emptyMessage={
              // The empty state names what was asked for, so "nothing here" is
              // legible as "nothing matched" rather than "nothing exists".
              filtersActive
                ? `No tasks match these filters: ${describeFilters(filters, query, eventItems)}. Use Clear Filters to widen the board.`
                : "No tasks yet. Use Add Tasks to create the first one."
            }
            onMove={(task, status, after) => void tasks.moveTask(task, status, after)}
            onEventChange={(task, eventId) => void tasks.changeEvent(task, eventId)}
            onUpdate={(task, patch) => void tasks.updateTask(task, patch)}
          />
        </section>
      )}
    </main>
  );
}
