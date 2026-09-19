import { createTaskSchema, taskPrioritySchema } from "@ctp/shared";
import { ListPlus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/common/page-header";
import { AssigneeField } from "@/components/tasks/assignee-field";
import { TaskBoard } from "@/components/tasks/task-board";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/hooks/use-events";
import { useMembers } from "@/hooks/use-members";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";

const selectBase =
  "w-full cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function TasksPage() {
  const tasks = useTasks();
  const events = useEvents();
  // The roster is one club-sized page, so the assignment editor searches it in
  // memory rather than asking the server for matches (see dashboard-search.tsx).
  const members = useMembers();
  const [adding, setAdding] = useState(false);
  const [validationError, setValidationError] = useState<string>();
  const [query, setQuery] = useState("");
  // The create dialog's draft assignments. They stay local until submit: the
  // create body is a single POST, so writing per toggle would have to create the
  // task before it has been filled in.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // The member popover portals into the dialog, not `document.body` — body sits
  // outside the scroll-lock shard, so a popover there cannot scroll. See
  // `AssigneeField`.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const taskItems = tasks.state.status === "ok" ? tasks.state.items : [];
  const eventItems = events.state.status === "ok" ? events.state.items : undefined;
  const memberItems = members.state.status === "ok" ? members.state.items : [];

  // Search stays over the page already loaded (the API caps the list at 50). An
  // empty query hands the board its own array back, untouched.
  const needle = query.trim().toLocaleLowerCase();
  const visibleTasks = needle
    ? taskItems.filter((task) => task.title.toLocaleLowerCase().includes(needle))
    : taskItems;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dueAt = String(data.get("dueAt") ?? "");
    // The shared schema owns the shape: it trims the title, rejects one that is
    // blank once trimmed, collapses an empty description to `null`, and fills the
    // defaults the API would apply anyway.
    const parsed = createTaskSchema.safeParse({
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      priority: data.get("priority"),
      eventId: String(data.get("eventId") ?? "") || undefined,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      // From the picker's draft, not `FormData`: the assignment control is not a
      // native form field, since it has to be searchable.
      assigneeIds,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Review the task details.");
      return;
    }
    setValidationError(undefined);
    void tasks.createTask(parsed.data).then((created) => {
      // On failure the dialog stays open, so nothing typed is lost.
      if (created) setAdding(false);
    });
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
                onChange={(event) => setQuery(event.target.value)}
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

      <Dialog
        open={adding}
        onOpenChange={(next) => {
          setAdding(next);
          // A closed dialog forgets its draft, so reopening starts clean rather
          // than showing the assignments from the abandoned attempt.
          if (!next) {
            setValidationError(undefined);
            setAssigneeIds([]);
            setPortalTarget(null);
          }
        }}
      >
        <DialogContent ref={setPortalTarget} size="wide">
          <DialogHeader className="shrink-0">
            <DialogTitle>Add a task</DialogTitle>
            <DialogDescription>
              The event, due date and assignees are optional and can be set later.
            </DialogDescription>
          </DialogHeader>

          <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
            <div className="grid shrink-0 gap-2">
              <Label htmlFor="new-task-title">Task</Label>
              <Input
                id="new-task-title"
                name="title"
                autoComplete="off"
                placeholder="e.g. Confirm venue access"
                maxLength={200}
                required
                className="h-10 text-base"
              />
            </div>

            {/* The metadata strip: everything bounded goes above the description,
                stacked on phones and three across from `sm`. */}
            <div className="grid shrink-0 gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="new-task-priority">Priority</Label>
                <select
                  id="new-task-priority"
                  name="priority"
                  defaultValue="medium"
                  className={cn(selectBase, "h-9")}
                >
                  {taskPrioritySchema.options.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority.charAt(0).toUpperCase() + priority.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="new-task-due">Due date</Label>
                <Input id="new-task-due" name="dueAt" type="datetime-local" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="new-task-event">Linked event</Label>
                <select
                  id="new-task-event"
                  name="eventId"
                  defaultValue=""
                  // No fabricated choices while the list is still loading.
                  disabled={!eventItems}
                  className={cn(selectBase, "h-9")}
                >
                  <option value="">No event</option>
                  {eventItems?.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* A fixed half-height: the description stays the largest single
                field without the dialog's slack deciding how tall it is. */}
            <div className="grid min-h-0 grow-0 basis-72 grid-rows-[auto_minmax(0,1fr)] gap-2">
              <Label htmlFor="new-task-description">Description</Label>
              <textarea
                id="new-task-description"
                name="description"
                maxLength={2000}
                placeholder="Add a more detailed description…"
                className="h-full min-h-24 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              />
            </div>

            <div className="grid shrink-0 gap-2">
              {/* Same searchable picker as the task modal. Selection is local
                  state until submit, because the create body is one POST and a
                  write per toggle would create the task before it is filled in. */}
              <span className="text-sm leading-none font-medium">Assignees</span>
              <AssigneeField
                members={memberItems}
                selectedIds={assigneeIds}
                onChange={setAssigneeIds}
                portalTarget={portalTarget}
                subject="this task"
                idPrefix="new-task"
                busy={tasks.busy === "new"}
              />
            </div>

            {validationError && (
              <p className="shrink-0 text-sm text-destructive" role="alert">
                {validationError}
              </p>
            )}
            {tasks.mutationError && (
              <p className="shrink-0 text-sm text-destructive" role="alert">
                {tasks.mutationError}. Try again.
              </p>
            )}

            <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={tasks.busy === "new"}>
                {tasks.busy === "new" ? "Adding…" : "Add Task"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* While the dialog is open the same message is repeated inside it, so the
          page only announces board failures (drag, assign, edit) on its own. */}
      {tasks.mutationError && !adding && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {tasks.mutationError}. Try again.
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
              announced. Only rendered while a query is active, which keeps
              "42 tasks" out of the tab order on an unfiltered board. */}
          {needle && (
            <p className="sr-only" role="status">
              {visibleTasks.length === 1
                ? "1 task matches your search."
                : `${visibleTasks.length} tasks match your search.`}
            </p>
          )}
          <TaskBoard
            tasks={visibleTasks}
            members={memberItems}
            events={eventItems}
            busyId={tasks.busy}
            error={tasks.mutationError}
            emptyMessage={
              needle
                ? "No tasks match your search."
                : "No tasks yet. Use Add Tasks to create the first one."
            }
            onStatusChange={(task, status) => void tasks.changeStatus(task, status)}
            onEventChange={(task, eventId) => void tasks.changeEvent(task, eventId)}
            onUpdate={(task, patch) => void tasks.updateTask(task, patch)}
          />
        </section>
      )}
    </main>
  );
}
