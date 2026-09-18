import type { EventSummary, RosterMember, Task } from "@ctp/shared";
import { CalendarDays, CheckSquare2, Search, UserRound, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DashboardSearch({
  tasks,
  events,
  members,
}: {
  tasks: Task[];
  events: EventSummary[];
  members: RosterMember[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();

  // ponytail: search the already-loaded club-sized pages; add a server search endpoint
  // when tasks or events regularly exceed their 50/25-row list limits.
  const results = needle
    ? [
        ...tasks
          .filter((task) => task.title.toLocaleLowerCase().includes(needle))
          .map((task) => ({
            id: `task-${task.id}`,
            label: task.title,
            detail: "Task",
            to: "/tasks",
            icon: CheckSquare2,
          })),
        ...events
          .filter((event) =>
            [event.title, event.venue].some((value) => value?.toLocaleLowerCase().includes(needle)),
          )
          .map((event) => ({
            id: `event-${event.id}`,
            label: event.title,
            detail: "Event",
            to: `/events/${event.id}`,
            icon: CalendarDays,
          })),
        ...members
          .filter((member) =>
            [member.name, member.email, member.portfolio].some((value) =>
              value?.toLocaleLowerCase().includes(needle),
            ),
          )
          .map((member) => ({
            id: `member-${member.id}`,
            label: member.name || member.email,
            detail: member.portfolio || member.role.replaceAll("_", " "),
            to: "/members",
            icon: UserRound,
          })),
      ].slice(0, 8)
    : [];

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (event.key.toLocaleLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", openSearch);
    return () => document.removeEventListener("keydown", openSearch);
  }, []);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" aria-keyshortcuts="Meta+K Control+K">
          <Search aria-hidden="true" />
          Search
          <kbd className="hidden rounded border bg-secondary px-1.5 py-0.5 font-sans text-[0.625rem] text-muted-foreground sm:inline">
            ⌘ K
          </kbd>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-xs" />
        <Dialog.Content className="fixed top-[15%] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-card shadow-xl">
          <Dialog.Title className="sr-only">Search Club Workspace</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search tasks, events, and club members.
          </Dialog.Description>
          <div className="flex items-center gap-3 border-b px-4 focus-within:ring-3 focus-within:ring-ring/50 focus-within:ring-inset">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <label htmlFor="dashboard-search" className="sr-only">
              Search Club Workspace
            </label>
            <Input
              id="dashboard-search"
              name="dashboard-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Search tasks, events, or people…"
              className="h-14 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close search">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-2">
            {!needle && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                Type to search your club workspace.
              </p>
            )}
            {needle && results.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                No results for “{query.trim()}”.
              </p>
            )}
            {results.map((result) => {
              const Icon = result.icon;
              return (
                <Link
                  key={result.id}
                  to={result.to}
                  onClick={() => changeOpen(false)}
                  className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="rounded-md bg-secondary p-2 text-muted-foreground">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{result.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground capitalize">
                      {result.detail}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
