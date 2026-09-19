import type { RosterMember } from "@ctp/shared";
import { Plus, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The roster stores a name that may be blank, so email is the fallback. */
function displayName(member: RosterMember): string {
  return member.name || member.email;
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
 * Shared by both dialogs. The two callers persist differently — the detail
 * dialog writes the whole set on each toggle, the create dialog edits a local
 * draft that is submitted with the rest of its form — so this component only
 * ever reports the next whole set and never touches the network. That also
 * means `onChange` is the edit switch: with it, the list is live; without it,
 * the assignments render as plain text with no control at all.
 */
export function AssigneeField({
  members,
  selectedIds,
  onChange,
  portalTarget,
  subject,
  idPrefix,
  busy = false,
  error,
}: {
  members: RosterMember[];
  selectedIds: string[];
  onChange?: (next: string[]) => void;
  portalTarget: HTMLElement | null;
  /** Names the member list for assistive tech — the task's title, or "this task". */
  subject: string;
  /** Keeps the popover's DOM ids unique when two instances could be mounted. */
  idPrefix: string;
  busy?: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = `member-picker-${idPrefix}`;

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
  const assigned = matches.filter((member) => selectedIds.includes(member.id));
  const others = matches.filter((member) => !selectedIds.includes(member.id));
  // Ids with no roster row: a member who left. Deliberately NOT search-filtered —
  // they have no name to search for, and their assignment must stay removable or
  // it could never be cleared. A set that only ever came from this roster (a task
  // being created) therefore has none.
  const departedIds = selectedIds.filter((id) => !members.some((member) => member.id === id));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="grid min-w-0 gap-2">
        <div className="flex items-start gap-2">
          {selectedIds.length === 0 ? (
            // A task may genuinely have no assignee — do not guess at a name.
            <span className="text-muted-foreground">Unassigned</span>
          ) : (
            <ul aria-label={`Assignees for ${subject}`} className="grid min-w-0 gap-1.5">
              {selectedIds.map((id) => {
                // An id the roster no longer holds is a member who left; the
                // assignment is real even though the name is gone.
                const member = members.find((candidate) => candidate.id === id);
                const name = member ? displayName(member) : "Former Member";
                return (
                  <li key={id} className="flex items-center gap-2">
                    <UserAvatar name={name} className="size-6 text-[0.625rem]" />
                    <span className="min-w-0 truncate">{name}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {onChange && (
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Add member to ${subject}`}
                className="text-muted-foreground"
              >
                <Plus aria-hidden="true" />
              </Button>
            </Popover.Trigger>
          )}
        </div>

        {onChange && portalTarget && (
          <Popover.Portal container={portalTarget}>
            <Popover.Content
              id={panelId}
              aria-label={`Members for ${subject}`}
              // `start`, not `end`: the `+` sits at the start of its row in
              // both dialogs, so a 288px panel aligned to its right edge would
              // overhang the dialog's left edge, and collision detection then
              // shifts it clear — leaving the panel floating, detached from the
              // control that opened it. Aligned to the start edge it needs no
              // shift and stays visually attached.
              align="start"
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
                          onClick={() => onChange(selectedIds.filter((id) => id !== member.id))}
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
                          onChange(selectedIds.filter((candidate) => candidate !== id))
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
                          onChange([...selectedIds, member.id]);
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
      </div>
    </Popover.Root>
  );
}
