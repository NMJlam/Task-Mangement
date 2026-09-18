import type { EventSummary, RosterMember, Task, UpdateTask } from "@ctp/shared";
import { Plus, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The roster stores a name that may be blank, so email is the fallback. */
function displayName(member: RosterMember): string {
  return member.name || member.email;
}

/**
 * One task: what it is, who holds it, and — when `onUpdate` is given — the
 * description field and the member picker behind the small `+` beside the
 * assignee list.
 *
 * Read-only by default: the event detail Tasks tab mounts this without the
 * callback, so edits stay owned by the main `/tasks` page.
 */
export function TaskDetailDialog({
  task,
  members,
  events,
  busy = false,
  onEventChange,
  onClose,
  onUpdate,
  error,
}: {
  task: Task | undefined;
  members: RosterMember[];
  events?: EventSummary[];
  busy?: boolean;
  onEventChange?: (task: Task, eventId: string | null) => void;
  onClose: () => void;
  onUpdate?: (patch: UpdateTask) => void;
  error?: string;
}) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      {task && (
        <TaskDetailBody
          key={task.id}
          task={task}
          members={members}
          events={events}
          onEventChange={onEventChange}
          onUpdate={onUpdate}
          busy={busy}
          error={error}
        />
      )}
    </Dialog>
  );
}

function TaskDetailBody({
  task,
  members,
  events,
  onEventChange,
  onUpdate,
  busy,
  error,
}: {
  task: Task;
  members: RosterMember[];
  events?: EventSummary[];
  onEventChange?: (task: Task, eventId: string | null) => void;
  onUpdate?: (patch: UpdateTask) => void;
  busy: boolean;
  error?: string;
}) {
  // The popover portals into the dialog content, not `document.body`. Body sits
  // OUTSIDE the scroll-lock shard that `Dialog` installs, so a popover there has
  // every wheel event cancelled (`react-remove-scroll`) and its list cannot
  // scroll. Inside the dialog it is a descendant of the shard and scrolls.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  return (
    <DialogContent ref={setPortalTarget} aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>{task.title}</DialogTitle>
        <DialogDescription>
          {task.dueAt ? `Due ${fullDate.format(task.dueAt)}` : "No due date set"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={task.status} />
        <span className="inline-flex w-fit items-center rounded-full bg-secondary px-2 py-1 text-xs leading-none font-medium text-secondary-foreground capitalize">
          {task.priority}
        </span>
        {task.aiRunId && (
          <span className="inline-flex w-fit items-center rounded-full bg-accent px-2 py-1 text-xs leading-none font-medium text-accent-foreground">
            AI drafted
          </span>
        )}
      </div>

      <dl className="grid gap-3 border-t pt-4 text-sm">
        {onEventChange && (
          <div className="flex items-center justify-between gap-3">
            <dt>
              <label htmlFor={`task-event-${task.id}`} className="text-muted-foreground">
                Linked event
              </label>
            </dt>
            <dd>
              <select
                id={`task-event-${task.id}`}
                value={task.eventId ?? ""}
                disabled={busy || !events}
                onChange={(event) => onEventChange(task, event.target.value || null)}
                className="h-9 max-w-56 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">No event</option>
                {task.eventId && !events?.some((event) => event.id === task.eventId) && (
                  <option value={task.eventId}>Current event</option>
                )}
                {events?.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Assignees</dt>
          <AssigneeField
            task={task}
            members={members}
            portalTarget={portalTarget}
            onUpdate={onUpdate}
            busy={busy}
            error={error}
          />
        </div>
        <Row label="Priority" value={capitalise(task.priority)} />
        {task.completedAt && <Row label="Completed" value={stamp.format(task.completedAt)} />}
        <Row label="Created" value={stamp.format(task.createdAt)} />
        <Row label="Last updated" value={stamp.format(task.updatedAt)} />
      </dl>

      {/* Keyed on the stored description, so once a save comes back the field
          shows what the server kept (trimmed, or empty for cleared) instead of
          the raw keystrokes. Typing does not change the stored value, so this
          never remounts mid-edit. */}
      <Description key={task.description ?? ""} task={task} onUpdate={onUpdate} busy={busy} />
    </DialogContent>
  );
}

/**
 * Trello's card back: a labelled multi-line field, saved on blur.
 *
 * Blur-save rather than a Save button keeps the card feeling like a card, and
 * the value is committed only when it actually changed — so tabbing through the
 * dialog never writes. Read-only when `onUpdate` is absent, in which case the
 * text is shown as prose.
 */
function Description({
  task,
  onUpdate,
  busy,
}: {
  task: Task;
  onUpdate?: (patch: UpdateTask) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(task.description ?? "");
  const changed = draft.trim() !== (task.description ?? "");

  if (!onUpdate) {
    return (
      <section className="grid gap-2 border-t pt-4">
        <h2 className="text-sm font-medium">Description</h2>
        {task.description ? (
          <p className="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
            {task.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
      </section>
    );
  }

  return (
    <section className="grid gap-2 border-t pt-4">
      <Label htmlFor={`description-${task.id}`}>Description</Label>
      <textarea
        id={`description-${task.id}`}
        name="description"
        value={draft}
        disabled={busy}
        rows={4}
        maxLength={2000}
        placeholder="Add a more detailed description…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          // An emptied field clears the description (the schema normalises ""
          // to null), and an untouched field writes nothing at all.
          if (changed) onUpdate({ description: draft });
        }}
        className="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
      />
    </section>
  );
}

/**
 * The `+` trigger and the searchable member list it reveals.
 *
 * A Radix Popover portaled INTO the dialog (`portalTarget`), which is the one
 * arrangement that satisfies all three constraints at once:
 *
 *   - it floats, so opening it overlays the metadata instead of pushing the
 *     dialog taller;
 *   - it is a DOM descendant of the dialog, which is the scroll-lock shard, so
 *     react-remove-scroll permits wheel events over its list. Portaled to
 *     `document.body` instead, every wheel event is cancelled and the list
 *     cannot be scrolled at all;
 *   - the dialog centres without a transform, so the popper's `strategy: fixed`
 *     resolves against the viewport rather than a transformed ancestor.
 *
 * Every row writes immediately — the whole set goes up on each toggle — so there
 * is no Save button and no draft that could diverge from the server. Rows are
 * disabled while a write is in flight, which is also what stops two fast clicks
 * from both being computed against the same stale set.
 */
function AssigneeField({
  task,
  members,
  portalTarget,
  onUpdate,
  busy,
  error,
}: {
  task: Task;
  members: RosterMember[];
  portalTarget: HTMLElement | null;
  onUpdate?: (patch: UpdateTask) => void;
  busy: boolean;
  error?: string;
}) {
  const assignedIds = task.assigneeIds;
  // The submitted array IS the new set — adding appends, removing filters, and
  // `[]` clears every assignment.
  const onChange = (next: string[]) => onUpdate?.({ assigneeIds: next });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = `member-picker-${task.id}`;

  // A search-first list should be typable the moment it appears.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? members.filter((member) =>
        [member.name, member.email].some((value) => value.toLocaleLowerCase().includes(needle)),
      )
    : members;
  // Both sections filter by the search, so a query that names someone already
  // assigned still finds them — and still offers the remove.
  const assigned = matches.filter((member) => assignedIds.includes(member.id));
  const others = matches.filter((member) => !assignedIds.includes(member.id));
  // Ids with no roster row: a member who left. Deliberately NOT search-filtered —
  // they have no name to search for, and their assignment must stay removable or
  // it could never be cleared.
  const departedIds = assignedIds.filter((id) => !members.some((member) => member.id === id));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <dd className="grid gap-2">
        <div className="flex items-start gap-2">
          {assignedIds.length === 0 ? (
            // A task may genuinely have no assignee — do not guess at a name.
            <span className="text-muted-foreground">Unassigned</span>
          ) : (
            <ul aria-label={`Assignees for ${task.title}`} className="grid gap-1.5">
              {assignedIds.map((id) => {
                // An id the roster no longer holds is a member who left; the
                // assignment is real even though the name is gone.
                const member = members.find((candidate) => candidate.id === id);
                const name = member ? displayName(member) : "Former Member";
                return (
                  <li key={id} className="flex items-center gap-2">
                    <UserAvatar name={name} className="size-6 text-[0.625rem]" />
                    {name}
                  </li>
                );
              })}
            </ul>
          )}

          {onUpdate && (
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Add member to ${task.title}`}
                className="text-muted-foreground"
              >
                <Plus aria-hidden="true" />
              </Button>
            </Popover.Trigger>
          )}
        </div>

        {portalTarget && (
          <Popover.Portal container={portalTarget}>
            <Popover.Content
              id={panelId}
              aria-label={`Members for ${task.title}`}
              align="end"
              side="bottom"
              sideOffset={6}
              // Kept INSIDE the dialog card: without a boundary the popper is
              // measured against the viewport, so it hangs below the modal and
              // covers the description. With the dialog as the boundary Radix
              // shifts or flips it to stay within the card.
              collisionBoundary={portalTarget}
              collisionPadding={12}
              className="z-50 grid w-[min(18rem,calc(100vw-3rem))] gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
              // A search-first list should be typable the moment it appears.
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                searchRef.current?.focus();
              }}
            >
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={searchRef}
                  name="assignee-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search members"
                  placeholder="Search members"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 pl-8 text-sm"
                />
              </div>

              <div className="grid max-h-48 gap-1 overflow-y-auto overscroll-contain">
                {/* The scroll container must shrink inside its grid parent, or a
                tall list stretches it and the max-height never applies. */}
                <div className="grid gap-1">
                  {assigned.length === 0 && departedIds.length === 0 && others.length === 0 && (
                    <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                      No members found.
                    </p>
                  )}

                  {(assigned.length > 0 || departedIds.length > 0) && (
                    <p className="px-1 text-xs font-semibold text-muted-foreground">Assigned</p>
                  )}
                  {assigned.map((member) => {
                    const name = displayName(member);
                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-2.5 rounded-md bg-secondary px-2 py-1.5"
                      >
                        <UserAvatar name={name} className="size-7 text-[0.6875rem]" />
                        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={busy}
                          onClick={() => onChange(assignedIds.filter((id) => id !== member.id))}
                          aria-label={`Remove ${name}`}
                          className="text-muted-foreground"
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                  {departedIds.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-2.5 rounded-md bg-secondary px-2 py-1.5"
                    >
                      <UserAvatar name="Former Member" className="size-7 text-[0.6875rem]" />
                      <span className="min-w-0 flex-1 truncate text-sm">Former Member</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={busy}
                        onClick={() =>
                          onChange(assignedIds.filter((candidate) => candidate !== id))
                        }
                        aria-label="Remove Former Member"
                        className="text-muted-foreground"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  ))}

                  {others.length > 0 && (
                    <p className="px-1 pt-1 text-xs font-semibold text-muted-foreground">
                      {assigned.length > 0 || departedIds.length > 0
                        ? "Other members"
                        : "All members"}
                    </p>
                  )}
                  {others.map((member) => {
                    const name = displayName(member);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onChange([...assignedIds, member.id]);
                          setQuery("");
                        }}
                        aria-label={`Assign ${name}`}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UserAvatar name={name} className="size-7 text-[0.6875rem]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{name}</span>
                          {member.name && member.email && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}. Try again.
                </p>
              )}
            </Popover.Content>
          </Popover.Portal>
        )}
      </dd>
    </Popover.Root>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
