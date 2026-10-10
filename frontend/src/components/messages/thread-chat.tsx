import type { DeletingViewer, Message, RosterMember, Thread } from "@ctp/shared";
import { canDeleteMessage, splitMentions } from "@ctp/shared";
import { Paperclip, Search, Send, Trash2, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { LoadingLine } from "@/components/common/loading-line";
import { UserAvatar } from "@/components/common/user-avatar";
import { MentionTextarea } from "@/components/messages/mention-textarea";
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
import type { ThreadChatModel } from "@/hooks/use-thread-chat";
import { continuations } from "@/lib/message-groups";
import { useShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const messageTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const clockTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/**
 * One conversation as a chat: its name and a search over it, the messages,
 * and the box to write in. The state is `useThreadChat`'s; this only draws it.
 */
export function ThreadChat({
  chat,
  title,
  kind,
  members,
  mentionMembers = members,
  selfId,
  viewer,
  titleAction,
  readOnly,
  className,
}: {
  chat: ThreadChatModel;
  title: string;
  kind: Thread["kind"];
  members: RosterMember[];
  /** Eligible composer targets; the full roster still resolves historical authors. */
  mentionMembers?: RosterMember[];
  selfId: string | undefined;
  /**
   * Who is reading, for which messages they may delete. Undefined while it
   * loads, and then no message offers to be deleted: a control that appears
   * and vanishes again, or one the API would refuse, is worse than a moment
   * without one.
   */
  viewer?: DeletingViewer;
  /**
   * Sits beside the title. Messages puts the way to an event thread's event
   * here, and the event's Thread tab the way back to Messages.
   */
  titleAction?: ReactNode;
  /**
   * Why the thread takes no new posts, shown where the box to write in would
   * be. A cancelled event's thread is a read-only archive, and the API answers
   * a post — or a deletion — in it with 409 THREAD_ARCHIVED.
   */
  readOnly?: string;
  className?: string;
}) {
  const { messages, searchInput, searchQuery } = chat;
  const headingId = useId();
  const searchId = useId();
  // The conversation's search is the page's `/`, on Messages and on an
  // event's Thread tab alike.
  const searchKey = useShortcut("search");
  const draftId = useId();
  const draftErrorId = useId();
  // The message whose deletion is being confirmed.
  const [confirmation, setConfirmation] = useState<{ message: Message }>();
  const confirming = confirmation?.message;
  const cancelRef = useRef<HTMLButtonElement>(null);

  const gone = messages.state.status === "gone";
  const chronological = messages.state.status === "ok" ? [...messages.state.items].reverse() : [];
  const continued = continuations(chronological, { searching: searchQuery.trim() !== "" });
  const deletable = (message: Message) =>
    !readOnly &&
    viewer !== undefined &&
    message.deletedAt === null &&
    canDeleteMessage(viewer, message);
  // A modal belongs to the conversation that opened it, never to the next
  // one shown by browser history or a remote deletion.
  if (confirming && (gone || !deletable(confirming) || confirming.channelId !== chat.threadId)) {
    setConfirmation(undefined);
  }
  const confirmError = confirming ? messages.deleteErrors[confirming.id] : undefined;
  const confirmBusy = confirming ? messages.deleting.has(confirming.id) : false;

  function closeConfirm() {
    if (confirming) messages.clearDeleteError(confirming.id);
    setConfirmation(undefined);
  }

  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="max-w-full min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              id={headingId}
              className="min-w-0 font-semibold tracking-tight [overflow-wrap:anywhere]"
            >
              {title}
            </h2>
            {titleAction}
          </div>
          <p className="mt-1 text-xs text-muted-foreground capitalize">{kind} thread</p>
        </div>
        <div className="relative w-full max-w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Label htmlFor={searchId} className="sr-only">
            Search this conversation
          </Label>
          <Input
            id={searchId}
            value={searchInput}
            onChange={(event) => chat.setSearchInput(event.target.value)}
            placeholder="Search messages"
            autoComplete="off"
            className="h-9 pl-8"
            disabled={gone}
            {...searchKey}
          />
          {searchInput && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => chat.setSearchInput("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite">
        {(messages.state.status === "idle" || messages.state.status === "loading") && (
          <LoadingLine label="Loading Messages…" />
        )}
        {messages.state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {messages.state.message}. Try again.
          </p>
        )}
        {gone && (
          <p className="py-12 text-center text-sm text-muted-foreground" role="status">
            This conversation is no longer available. It may have been deleted.
          </p>
        )}
        {messages.state.status === "ok" && messages.state.items.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {searchQuery
              ? `No messages match "${searchQuery}".`
              : "No messages yet. Start the conversation below."}
          </p>
        )}
        {messages.state.status === "ok" && messages.state.nextCursor !== null && (
          <div className="mb-5 flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={messages.loadingOlder}
              onClick={() => void messages.loadOlder()}
            >
              {messages.loadingOlder ? "Loading…" : "Load older messages"}
            </Button>
            {messages.olderError && (
              <p className="text-sm text-destructive" role="alert">
                {messages.olderError}. Try again.
              </p>
            )}
          </div>
        )}
        {messages.state.status === "ok" && (
          <div>
            {chronological.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                members={members}
                continued={continued[index]!}
                first={index === 0}
                onDelete={deletable(message) ? () => setConfirmation({ message }) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {gone ? null : readOnly ? (
        <p className="border-t p-4 text-sm text-muted-foreground sm:p-5">{readOnly}</p>
      ) : (
        <form
          className="border-t p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            chat.send();
          }}
        >
          {messages.sendError && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {messages.sendError}. Try again.
            </p>
          )}
          {chat.draftError && (
            <p id={draftErrorId} className="mb-3 text-sm text-destructive" role="alert">
              {chat.draftError}
            </p>
          )}
          <label htmlFor={draftId} className="sr-only">
            Message {title}
          </label>
          <MentionTextarea
            key={chat.threadId}
            id={draftId}
            name="message"
            rows={3}
            maxLength={4000}
            placeholder="Write a message…"
            // The moves can enter this box; Escape steps back out.
            data-key-field
            className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
            required
            aria-invalid={chat.draftError ? true : undefined}
            aria-describedby={chat.draftError ? draftErrorId : undefined}
            value={chat.draft}
            onChange={chat.setDraft}
            candidates={mentionMembers}
            selfId={selfId}
          />
          <div className="mt-2 flex justify-end">
            <Button disabled={messages.sending}>
              <Send aria-hidden="true" />
              {messages.sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}

      <Dialog open={confirming !== undefined} onOpenChange={(open) => !open && closeConfirm()}>
        <DialogContent
          // Cancel is where focus starts: Enter on a dialog that just opened
          // must never be the thing that deletes.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this message for everyone?</DialogTitle>
            <DialogDescription>
              Everyone in this conversation will see “Message deleted” in its place. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {confirmError && (
            <p className="text-sm text-destructive" role="alert">
              {confirmError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button ref={cancelRef} variant="ghost" disabled={confirmBusy} onClick={closeConfirm}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmBusy}
              onClick={() => {
                const message = confirming;
                if (!message) return;
                void chat.deleteMessage(message).then((deleted) => {
                  if (deleted) {
                    setConfirmation((current) => (current === confirmation ? undefined : current));
                  }
                });
              }}
            >
              {confirmBusy ? "Deleting…" : "Delete message"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * One message. The first of a run from one sender shows who and when; the
 * rest of the run (`continued`) line up under its text with no header of
 * their own. Each is still its own article, named for its sender and time, so
 * a screen reader — and the always-visible time for keyboard/touch users — never
 * loses either.
 */
function MessageRow({
  message,
  members,
  continued,
  first,
  onDelete,
}: {
  message: Message;
  members: RosterMember[];
  continued: boolean;
  first: boolean;
  onDelete: (() => void) | undefined;
}) {
  const author = members.find((member) => member.id === message.author);
  // A message the assistant wrote is posted under the member who ran it, so
  // `aiRunId`, not the author, says whose words these are.
  const name = message.aiRunId ? "MAC Assistant" : author?.name || author?.email || "Former Member";
  const deleted = message.deletedAt !== null;
  const when = messageTime.format(message.createdAt);

  return (
    <article
      aria-label={`${name}, ${when}`}
      className={cn(
        "group relative flex items-start gap-3 focus-within:bg-accent/40 hover:bg-accent/40",
        // Tighter inside a run, the usual gap before a new one.
        !first && (continued ? "mt-0.5" : "mt-4"),
        continued && "pl-17",
      )}
    >
      {!continued && (
        <div className="flex w-14 shrink-0 justify-end">
          <UserAvatar name={name} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {continued ? (
          // Always readable, including on touch and rows without actions.
          <time
            dateTime={message.createdAt.toISOString()}
            title={when}
            className="absolute top-0.5 left-0 w-14 text-right text-[0.625rem] whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {clockTime.format(message.createdAt)}
          </time>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{name}</h3>
            <time
              dateTime={message.createdAt.toISOString()}
              className="text-xs text-muted-foreground"
            >
              {when}
            </time>
          </div>
        )}
        {deleted ? (
          <p className={cn("text-sm text-muted-foreground italic", !continued && "mt-1")}>
            Message deleted
          </p>
        ) : (
          <>
            {message.body && (
              <p
                className={cn(
                  "text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap",
                  !continued && "mt-1",
                )}
              >
                {splitMentions(message.body).map((part, index) =>
                  typeof part === "string" ? (
                    <span key={index}>{part}</span>
                  ) : (
                    <span
                      key={index}
                      className="bg-primary/10 px-1 py-0.5 font-medium text-primary"
                    >
                      @{mentionName(part.userId, members)}
                    </span>
                  ),
                )}
              </p>
            )}
            {message.fileName && (
              <p className="mt-2 inline-flex max-w-full items-center gap-1.5 bg-accent px-2 py-1 text-xs [overflow-wrap:anywhere]">
                <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
                {message.fileName}
              </p>
            )}
          </>
        )}
      </div>
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete message from ${name}, ${when}`}
          onClick={onDelete}
          // Shown when the row is pointed at or anything in it has focus, and
          // always on a touch screen, which has no hover to reveal it.
          className="shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    </article>
  );
}

function mentionName(userId: string, members: RosterMember[]): string {
  const member = members.find((candidate) => candidate.id === userId);
  return member?.name || member?.email || "a former member";
}
