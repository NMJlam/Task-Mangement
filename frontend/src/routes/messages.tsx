import { canDeleteGroup, type RosterMember, type Thread } from "@ctp/shared";
import { CalendarDays, Hash, MessageCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LoadingLine } from "@/components/common/loading-line";
import { LogLine } from "@/components/common/log-line";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { ShellEmpty } from "@/components/common/shell-empty";
import { DeleteGroupDialog } from "@/components/messages/delete-group-dialog";
import { GroupMembersDialog } from "@/components/messages/group-members-dialog";
import { NewConversationDialog } from "@/components/messages/new-conversation-dialog";
import { ThreadChat } from "@/components/messages/thread-chat";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useThreadChat } from "@/hooks/use-thread-chat";
import { useThreads } from "@/hooks/use-threads";
import { useShortcut } from "@/lib/shortcuts";
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
  // The group whose deletion is being confirmed.
  const [deletingGroup, setDeletingGroup] = useState<Thread>();
  const newKey = useShortcut("new");
  const threadItems = threads.state.status === "ok" ? threads.state.items : [];
  const unreadTotal = threadItems.reduce((total, thread) => total + thread.unreadCount, 0);

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

  // A deleted message changes the conversation's unread count and last
  // activity, and a conversation the server stopped showing (deleted by
  // someone else, or access lost) should leave the list: either way, re-read it.
  const reloadThreads = threads.reload;
  const chat = useThreadChat(active?.id, {
    onSent: threads.noteActivity,
    onDeleted: reloadThreads,
    onGone: reloadThreads,
  });
  const memberItems = members.state.status === "ok" ? members.state.items : [];
  const mentionMembers =
    active?.kind === "group" || active?.kind === "dm"
      ? memberItems.filter((member) => active.memberIds.includes(member.id))
      : memberItems;
  const markThreadRead = threads.markRead;
  const selfId = me.status === "ok" ? me.user.id : undefined;
  const viewer = me.status === "ok" ? { id: me.user.id, role: me.user.role } : undefined;
  const mayDeleteActive =
    active !== undefined &&
    viewer !== undefined &&
    canDeleteGroup(viewer, {
      kind: active.kind,
      createdBy: active.createdBy,
      isMember: active.memberIds.includes(viewer.id),
    });

  // A confirmation belongs to the conversation and permission on screen.
  if (deletingGroup && (deletingGroup.id !== active?.id || !mayDeleteActive)) {
    setDeletingGroup(undefined);
  }

  useEffect(() => {
    if (active) void markThreadRead(active);
  }, [active, markThreadRead]);

  // A `?thread=` the list no longer has — deleted here or elsewhere, or never
  // listed — is replaced by the conversation shown in its place, or dropped
  // when there is none, so a refresh or a shared link never names a dead one.
  const activeId = active?.id;
  const listed = threads.state.status === "ok";
  const requestedListed = threadItems.some((thread) => thread.id === requested);
  useEffect(() => {
    if (!listed || !requested || requestedListed) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (activeId) next.set("thread", activeId);
        else next.delete("thread");
        return next;
      },
      { replace: true },
    );
  }, [listed, requested, requestedListed, activeId, setSearchParams]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Messages"
        hints={["move", "open", "new", "search", "leave", "help"]}
        description="Event threads and committee conversations."
        actions={
          <Button onClick={() => setDialogOpen(true)} {...newKey}>
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
        <LogLine tone="err" className="mt-8">
          Couldn&apos;t load conversations: {threads.state.message}. Refresh the page to try again.
        </LogLine>
      )}
      {deletingGroup && (
        <DeleteGroupDialog
          name={threadName(deletingGroup, memberItems, selfId)}
          busy={threads.deletingId === deletingGroup.id}
          error={
            threads.deleteError?.threadId === deletingGroup.id
              ? threads.deleteError.message
              : undefined
          }
          onClose={() => {
            setDeletingGroup(undefined);
            threads.clearDeleteError();
          }}
          // On success the group leaves the list, the next conversation opens
          // in its place and the URL follows; on failure it all stays put.
          onConfirm={() =>
            void threads.deleteGroup(deletingGroup).then((deleted) => {
              if (deleted)
                setDeletingGroup((current) => (current === deletingGroup ? undefined : current));
            })
          }
        />
      )}

      {threads.state.status === "ok" && threadItems.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed">
          <ShellEmpty command="ls threads/" message="No conversations are available yet." />
        </div>
      )}
      {threads.state.status === "ok" && active && (
        // Two panes, lazygit's way: the conversations titled in their border,
        // with their keys in the foot, and the open conversation beside them.
        <div className="mt-8 grid min-h-[36rem] grid-cols-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Panel
            title="Conversations"
            meta={unreadTotal > 0 ? `${unreadTotal} unread` : undefined}
            className="min-w-0"
            bodyClassName="p-1"
          >
            {/* A key list: j/k walk the conversations, enter opens one. The
                padding leaves room for each button's focus outline inside the
                scroller. */}
            <nav
              aria-label="Conversations"
              data-key-list="threads"
              className="flex gap-1 overflow-x-auto p-1 lg:block lg:overflow-y-auto"
            >
              {threadItems.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  data-key-item
                  aria-current={thread.id === active.id ? "true" : undefined}
                  onClick={() => select(thread.id)}
                  className={cn(
                    "tui-row flex min-w-48 cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground lg:mb-1 lg:w-full lg:min-w-0",
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
                    <span className="tui-keep ml-auto bg-primary px-1.5 py-0.5 text-[0.625rem] text-primary-foreground tabular-nums">
                      {thread.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </Panel>

          {/* Its top meets the Conversations pane's line, which sits half a
              title row down. */}
          <div className="flex min-w-0 border bg-card lg:mt-3">
            <ThreadChat
              chat={chat}
              title={threadName(active, memberItems, selfId)}
              kind={active.kind}
              members={memberItems}
              mentionMembers={mentionMembers}
              selfId={selfId}
              viewer={viewer}
              titleAction={
                <>
                  {/* The same conversation, on its event's page — beside the
                      event's tasks and the thread summary. */}
                  {active.eventId && (
                    <Button asChild variant="outline" size="xs">
                      <Link to={`/events/${active.eventId}?tab=thread`}>
                        <CalendarDays aria-hidden="true" />
                        View event
                      </Link>
                    </Button>
                  )}
                  {active.kind === "group" && (
                    <GroupMembersDialog
                      key={active.id}
                      name={threadName(active, memberItems, selfId)}
                      memberIds={active.memberIds}
                      members={memberItems}
                      selfId={selfId}
                      createdBy={active.createdBy}
                      rosterStatus={members.state.status}
                    />
                  )}
                  {/* Only for a group, and only to those the API would let
                      delete it: the president, or the member who opened it. */}
                  {mayDeleteActive && (
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => {
                        threads.clearDeleteError();
                        setDeletingGroup(active);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete group
                    </Button>
                  )}
                </>
              }
              className="flex-1"
            />
          </div>
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
