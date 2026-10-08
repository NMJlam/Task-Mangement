import type { Message, RosterMember, Thread } from "@ctp/shared";
import { splitMentions } from "@ctp/shared";
import { Paperclip, Search, Send, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { UserAvatar } from "@/components/common/user-avatar";
import { MentionTextarea } from "@/components/messages/mention-textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ThreadChatModel } from "@/hooks/use-thread-chat";
import { cn } from "@/lib/utils";

const messageTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * One conversation as a chat: its name and a search over it, the messages,
 * and the box to write in. The state is `useThreadChat`'s; this only draws it.
 */
export function ThreadChat({
  chat,
  title,
  kind,
  members,
  selfId,
  titleAction,
  className,
}: {
  chat: ThreadChatModel;
  title: string;
  kind: Thread["kind"];
  members: RosterMember[];
  selfId: string | undefined;
  /** Sits beside the title — Messages puts the way to an event thread's event here. */
  titleAction?: ReactNode;
  className?: string;
}) {
  const { messages, searchInput, searchQuery } = chat;
  const headingId = useId();
  const searchId = useId();
  const draftId = useId();

  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={headingId} className="font-semibold tracking-tight">
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
          <p className="text-sm text-muted-foreground" role="status">
            Loading Messages…
          </p>
        )}
        {messages.state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {messages.state.message}. Try again.
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
          <div className="grid gap-5">
            {[...messages.state.items].reverse().map((message) => (
              <MessageRow key={message.id} message={message} members={members} />
            ))}
          </div>
        )}
      </div>

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
        <label htmlFor={draftId} className="sr-only">
          Message {title}
        </label>
        <MentionTextarea
          id={draftId}
          name="message"
          rows={3}
          maxLength={4000}
          placeholder="Write a message…"
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
          required
          value={chat.draft}
          onChange={chat.setDraft}
          candidates={members}
          selfId={selfId}
        />
        <div className="mt-2 flex justify-end">
          <Button disabled={messages.sending}>
            <Send aria-hidden="true" />
            {messages.sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function MessageRow({ message, members }: { message: Message; members: RosterMember[] }) {
  const author = members.find((member) => member.id === message.author);
  // A message the assistant wrote is posted under the member who ran it, so
  // `aiRunId`, not the author, says whose words these are.
  const name = message.aiRunId ? "MAC Assistant" : author?.name || author?.email || "Former Member";

  return (
    <article className="flex items-start gap-3">
      <UserAvatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">{name}</h3>
          <time
            dateTime={message.createdAt.toISOString()}
            className="text-xs text-muted-foreground"
          >
            {messageTime.format(message.createdAt)}
          </time>
        </div>
        {message.body && (
          <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">
            {splitMentions(message.body).map((part, index) =>
              typeof part === "string" ? (
                <span key={index}>{part}</span>
              ) : (
                <span key={index} className="bg-primary/10 px-1 py-0.5 font-medium text-primary">
                  @{mentionName(part.userId, members)}
                </span>
              ),
            )}
          </p>
        )}
        {message.fileName && (
          <p className="mt-2 inline-flex items-center gap-1.5 bg-accent px-2 py-1 text-xs">
            <Paperclip aria-hidden="true" className="size-3.5" />
            {message.fileName}
          </p>
        )}
      </div>
    </article>
  );
}

function mentionName(userId: string, members: RosterMember[]): string {
  const member = members.find((candidate) => candidate.id === userId);
  return member?.name || member?.email || "a former member";
}
