import type { Message, RosterMember, Thread } from "@ctp/shared";
import { Hash, MessageCircle, Paperclip, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useThreadMessages, useThreads } from "@/hooks/use-threads";
import { cn } from "@/lib/utils";

const messageTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function MessagesPage() {
  const me = useMe();
  const threads = useThreads();
  const members = useMembers();
  const [selectedId, setSelectedId] = useState<string>();
  const threadItems = threads.state.status === "ok" ? threads.state.items : [];
  const active = threadItems.find((thread) => thread.id === selectedId) ?? threadItems[0];
  const messages = useThreadMessages(active?.id);
  const memberItems = members.state.status === "ok" ? members.state.items : [];
  const markThreadRead = threads.markRead;

  useEffect(() => {
    if (active) void markThreadRead(active);
  }, [active, markThreadRead]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("message") ?? "").trim();
    if (!body) return;
    void messages.send(body).then((sent) => {
      if (sent) form.reset();
    });
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader title="Messages" description="Event threads and committee conversations." />

      {threads.state.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Conversations…
        </p>
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
                onClick={() => setSelectedId(thread.id)}
                className={cn(
                  "flex min-w-48 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-[background-color,color] hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:mb-1 lg:w-full lg:min-w-0",
                  thread.id === active.id && "bg-accent font-medium text-accent-foreground",
                )}
              >
                {thread.kind === "dm" ? (
                  <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
                ) : (
                  <Hash aria-hidden="true" className="size-4 shrink-0" />
                )}
                <span className="truncate">
                  {threadName(thread, memberItems, me.status === "ok" ? me.user.id : undefined)}
                </span>
                {thread.unreadCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[0.625rem] text-primary-foreground tabular-nums">
                    {thread.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <section aria-labelledby="active-thread-heading" className="flex min-w-0 flex-col">
            <header className="border-b px-4 py-4 sm:px-6">
              <h2 id="active-thread-heading" className="font-semibold tracking-tight">
                {threadName(active, memberItems, me.status === "ok" ? me.user.id : undefined)}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground capitalize">{active.kind} thread</p>
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
                  No messages yet. Start the conversation below.
                </p>
              )}
              {messages.state.status === "ok" && (
                <div className="grid gap-5">
                  {[...messages.state.items].reverse().map((message) => (
                    <MessageRow key={message.id} message={message} members={memberItems} />
                  ))}
                </div>
              )}
            </div>

            <form className="border-t p-4 sm:p-5" onSubmit={submit}>
              {messages.sendError && (
                <p className="mb-3 text-sm text-destructive" role="alert">
                  {messages.sendError}. Try again.
                </p>
              )}
              <label htmlFor="message" className="sr-only">
                Message{" "}
                {threadName(active, memberItems, me.status === "ok" ? me.user.id : undefined)}
              </label>
              <textarea
                id="message"
                name="message"
                rows={3}
                maxLength={4000}
                placeholder="Write a message…"
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                required
              />
              <div className="mt-2 flex justify-end">
                <Button disabled={messages.sending}>
                  <Send aria-hidden="true" />
                  {messages.sending ? "Sending…" : "Send"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function MessageRow({ message, members }: { message: Message; members: RosterMember[] }) {
  const author = members.find((member) => member.id === message.author);
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
          <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
        )}
        {message.fileName && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs">
            <Paperclip aria-hidden="true" className="size-3.5" />
            {message.fileName}
          </p>
        )}
      </div>
    </article>
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
  if (thread.kind === "ai") return "MAC Assistant";
  return "Untitled Conversation";
}
