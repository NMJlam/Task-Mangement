import type { RosterMember, Thread } from "@ctp/shared";
import { CalendarDays, Hash, MessageCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LoadingLine } from "@/components/common/loading-line";
import { PageHeader } from "@/components/common/page-header";
import { NewConversationDialog } from "@/components/messages/new-conversation-dialog";
import { ThreadChat } from "@/components/messages/thread-chat";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useThreadChat } from "@/hooks/use-thread-chat";
import { useThreads } from "@/hooks/use-threads";
import { cn } from "@/lib/utils";

export function MessagesPage() {
  const me = useMe();
  const threads = useThreads();
  const members = useMembers();
  // `?thread=` names the conversation to open, so a link — the event page's
  // "Open in Messages" — can land on one, and a refresh keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("thread") ?? undefined;
  const [selectedId, setSelectedId] = useState(requested);
  const [dialogOpen, setDialogOpen] = useState(false);
  const threadItems = threads.state.status === "ok" ? threads.state.items : [];

  // A link to another conversation while Messages is already open changes only
  // the URL, not the mount, so the pin follows the URL when it moves — settled
  // while rendering, like the pin itself.
  const [followed, setFollowed] = useState(requested);
  if (requested !== followed) {
    setFollowed(requested);
    if (requested) setSelectedId(requested);
  }

  // The conversation on screen is pinned by id. The list re-sorts by activity
  // on every refresh, so "whichever is first" would move the reader to another
  // conversation — wiping their draft and search — without a click. A new one
  // is chosen only when there is none yet, or the pinned one has gone.
  //
  // Settled while rendering, not in an effect, for the same reason as the
  // chat's own reset of its draft and search: an effect runs only after the
  // conversation is on screen, so a refresh landing first would find nothing
  // pinned.
  if (threads.state.status === "ok" && !threadItems.some((thread) => thread.id === selectedId)) {
    const fallback = threadItems[0]?.id;
    if (fallback !== selectedId) setSelectedId(fallback);
  }
  const active = threadItems.find((thread) => thread.id === selectedId) ?? threadItems[0];

  // Every choice the reader makes is written back, replacing rather than
  // pushing, so Back still leaves Messages instead of stepping through each
  // conversation opened.
  function select(threadId: string) {
    setSelectedId(threadId);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("thread", threadId);
        return next;
      },
      { replace: true },
    );
  }

  const chat = useThreadChat(active?.id, threads.noteActivity);
  const memberItems = members.state.status === "ok" ? members.state.items : [];
  const markThreadRead = threads.markRead;
  const selfId = me.status === "ok" ? me.user.id : undefined;

  useEffect(() => {
    if (active) void markThreadRead(active);
  }, [active, markThreadRead]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Messages"
        description="Event threads and committee conversations."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden="true" />
            New message
          </Button>
        }
      />

      <NewConversationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          threads.clearCreateError();
        }}
        members={memberItems}
        selfId={selfId}
        busy={threads.creating}
        error={threads.createError}
        onCreateDm={async (memberId) => {
          const thread = await threads.create({ kind: "dm", memberId });
          if (thread) select(thread.id);
          return Boolean(thread);
        }}
        onCreateGroup={async (name, memberIds) => {
          const thread = await threads.create({ kind: "group", name, memberIds });
          if (thread) select(thread.id);
          return Boolean(thread);
        }}
      />

      {threads.state.status === "loading" && (
        <LoadingLine label="Loading Conversations…" className="mt-8" />
      )}
      {threads.state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load conversations: {threads.state.message}. Refresh the page to try again.
        </p>
      )}
      {threads.state.status === "ok" && threadItems.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No conversations are available yet.
        </div>
      )}
      {threads.state.status === "ok" && active && (
        <div className="mt-8 grid min-h-[36rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav
            aria-label="Conversations"
            className="flex gap-1 overflow-x-auto border-b p-3 lg:block lg:overflow-y-auto lg:border-r lg:border-b-0"
          >
            {threadItems.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => select(thread.id)}
                className={cn(
                  "flex min-w-48 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground lg:mb-1 lg:w-full lg:min-w-0",
                  thread.id === active.id && "bg-accent font-medium text-accent-foreground",
                )}
              >
                {thread.kind === "dm" ? (
                  <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
                ) : (
                  <Hash aria-hidden="true" className="size-4 shrink-0" />
                )}
                <span className="truncate">{threadName(thread, memberItems, selfId)}</span>
                {thread.unreadCount > 0 && (
                  <span className="ml-auto bg-primary px-1.5 py-0.5 text-[0.625rem] text-primary-foreground tabular-nums">
                    {thread.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <ThreadChat
            chat={chat}
            title={threadName(active, memberItems, selfId)}
            kind={active.kind}
            members={memberItems}
            selfId={selfId}
            titleAction={
              // The same conversation, on its event's page — beside the
              // event's tasks and the thread summary.
              active.eventId && (
                <Button asChild variant="outline" size="xs">
                  <Link to={`/events/${active.eventId}?tab=thread`}>
                    <CalendarDays aria-hidden="true" />
                    View event
                  </Link>
                </Button>
              )
            }
          />
        </div>
      )}
    </main>
  );
}

function threadName(thread: Thread, members: RosterMember[], myId: string | undefined) {
  if (thread.name) return thread.name;
  if (thread.kind === "dm") {
    const other = members.find(
      (member) => member.id !== myId && thread.memberIds.includes(member.id),
    );
    return other?.name || other?.email || "Direct Message";
  }
  return "Untitled Conversation";
}
