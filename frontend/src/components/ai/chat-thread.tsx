import type { AiApplyOperation, AiChatMessage, RosterMember } from "@ctp/shared";
import { Bot, CalendarDays, PowerOff, Send } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ProposalCard } from "./proposal-card";
import { Button } from "@/components/ui/button";
import type { ApplyStats } from "@/hooks/use-ai-chat";

const messageTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The right column of AI Breakdown: one chat's header, conversation and
 * composer. Declarative — everything it shows and does arrives as props from
 * the page's view-models.
 */
export function ChatThread({
  chatKey,
  title,
  seedEventId,
  messages,
  loading = false,
  thinking,
  pending,
  error,
  disabled,
  members,
  onSend,
  onApply,
  onDiscard,
  headerActions,
  children,
}: {
  /** Changes when a different conversation is opened, so a half-typed message never follows the member across. */
  chatKey: number;
  title: string;
  seedEventId: string | null;
  messages: AiChatMessage[];
  loading?: boolean;
  thinking: boolean;
  pending: boolean;
  error: string | undefined;
  disabled: boolean;
  members: RosterMember[];
  /** Resolves false when the turn failed, so the text can go back in the box. */
  onSend: (text: string) => Promise<boolean>;
  onApply: (runId: string, operations: AiApplyOperation[], stats: ApplyStats) => void;
  onDiscard: (runId: string) => void;
  headerActions?: ReactNode;
  /** Shown above the conversation: the Generated panel. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [chatKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    // Nothing is saved for a failed turn, so the message is not lost with it.
    if (!(await onSend(text))) setDraft(text);
  }

  return (
    <section aria-labelledby="ai-chat-heading" className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-6">
        <h2 id="ai-chat-heading" className="min-w-0 flex-1 truncate font-semibold tracking-tight">
          {title}
        </h2>
        {seedEventId && (
          <Link
            to={`/events/${seedEventId}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <CalendarDays aria-hidden="true" className="size-3.5" />
            About this event
          </Link>
        )}
        {headerActions}
      </header>

      {children}

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite">
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading chat…
          </p>
        ) : messages.length === 0 && !thinking ? (
          <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            Ask what&apos;s overdue, or to plan an event. Nothing changes until you confirm a plan.
          </p>
        ) : (
          <ol className="grid gap-5">
            {messages.map((message) => (
              <Turn
                key={message.id}
                message={message}
                members={members}
                pending={pending}
                onApply={onApply}
                onDiscard={onDiscard}
              />
            ))}
            {thinking && <ThinkingTurn />}
          </ol>
        )}
      </div>

      <div className="border-t p-4 sm:px-6">
        {error && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {disabled ? (
          <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
            <PowerOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">The assistant is switched off</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                This deployment has no AI service connected. Your past chats stay here.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2">
            <label htmlFor="assistant-draft" className="sr-only">
              Message the assistant
            </label>
            <textarea
              id="assistant-draft"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter keeps a newline — the chat convention.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Plan the hack night, or ask what's overdue…"
              className="min-h-10 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="submit" disabled={pending || !draft.trim()}>
              <Send aria-hidden="true" />
              Send
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function Turn({
  message,
  members,
  pending,
  onApply,
  onDiscard,
}: {
  message: AiChatMessage;
  members: RosterMember[];
  pending: boolean;
  onApply: (runId: string, operations: AiApplyOperation[], stats: ApplyStats) => void;
  onDiscard: (runId: string) => void;
}) {
  const fromAssistant = message.role === "assistant";
  const { runId, proposal, proposalStatus } = message;

  return (
    <li className={fromAssistant ? "pr-6" : "pl-6"}>
      <article
        className={
          fromAssistant
            ? "rounded-lg border bg-background p-4"
            : "rounded-lg bg-secondary p-4 text-secondary-foreground"
        }
      >
        <div className="flex items-center gap-2">
          {fromAssistant && <Bot aria-hidden="true" className="size-4 text-muted-foreground" />}
          <h3 className="text-xs font-semibold">{fromAssistant ? "MAC Assistant" : "You"}</h3>
          <time
            dateTime={message.createdAt.toISOString()}
            className="ml-auto text-xs text-muted-foreground"
          >
            {messageTime.format(message.createdAt)}
          </time>
        </div>
        <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </article>

      {runId && proposal && proposalStatus === "open" && (
        <div className="mt-3">
          <ProposalCard
            key={runId}
            proposal={proposal}
            members={members}
            busy={pending}
            onApply={(operations, stats) => onApply(runId, operations, stats)}
            onDiscard={() => onDiscard(runId)}
          />
        </div>
      )}
      {proposalStatus === "applied" && <AppliedNote applied={message.applied} />}
      {proposalStatus === "discarded" && (
        <p className="mt-2 text-sm text-muted-foreground">Discarded</p>
      )}
    </li>
  );
}

/** What a confirmed plan made, each linking to where it now lives. */
function AppliedNote({ applied }: { applied: AiChatMessage["applied"] }) {
  const made = [
    ...(applied?.events ?? []).map((event) => ({ ...event, to: `/events/${event.id}` })),
    ...(applied?.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      to: task.eventId ? `/events/${task.eventId}?tab=tasks` : "/tasks",
    })),
  ];
  return (
    <div className="mt-3 rounded-lg border p-3 text-sm">
      <p className="font-medium">Applied</p>
      {made.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {made.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The assistant's bubble while its reply is still being worked out. The dots
 * are decoration: the status text is what assistive tech announces, and they
 * hold still for anyone who has asked their system for reduced motion.
 */
function ThinkingTurn() {
  return (
    <li className="pr-6">
      <article className="rounded-lg border bg-background p-4">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold">MAC Assistant</h3>
        </div>
        <div role="status" aria-label="MAC Assistant is thinking" className="mt-3 flex gap-1">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              aria-hidden="true"
              style={{ animationDelay: `${delay}ms` }}
              className="size-2 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
            />
          ))}
        </div>
      </article>
    </li>
  );
}
