import { aiBriefingSchema, type AiBriefing, type Message, type Task } from "@ctp/shared";
import { Bot, PowerOff, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ProposalCard } from "@/components/ai/proposal-card";
import { PageHeader } from "@/components/common/page-header";
import { PriorityDot } from "@/components/common/priority-dot";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAssistant, type AssistantTurn } from "@/hooks/use-assistant";
import { useMembers } from "@/hooks/use-members";
import { useTasks } from "@/hooks/use-tasks";
import { useThreadMessages, useThreads } from "@/hooks/use-threads";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AiBreakdownPage() {
  const [searchParams] = useSearchParams();
  const assistant = useAssistant({ eventId: searchParams.get("eventId") ?? undefined });
  const members = useMembers();
  const [draft, setDraft] = useState("");
  const threads = useThreads();
  const tasks = useTasks();
  const assistantThread =
    threads.state.status === "ok"
      ? threads.state.items.find((thread) => thread.kind === "ai")
      : undefined;
  const messages = useThreadMessages(assistantThread?.id);
  const generatedTasks =
    tasks.state.status === "ok" ? tasks.state.items.filter((task) => task.aiRunId) : [];
  const loading =
    threads.state.status === "loading" ||
    tasks.state.status === "loading" ||
    messages.state.status === "loading" ||
    (messages.state.status === "idle" && Boolean(assistantThread));
  const error =
    threads.state.status === "error"
      ? threads.state.message
      : tasks.state.status === "error"
        ? tasks.state.message
        : messages.state.status === "error"
          ? messages.state.message
          : undefined;

  const history = messages.state.status === "ok" ? [...messages.state.items].reverse() : [];
  const turns = assistant.state.status === "ok" ? assistant.state.turns : [];
  const staged = assistant.state.status === "ok" ? assistant.state.staged : undefined;
  // Waiting on a reply, as opposed to waiting on an apply: the last thing said
  // was the member's. A turn is several model calls, so this can be many seconds.
  const thinking = assistant.pending && turns.at(-1)?.role === "member";

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || assistant.pending) return;
    setDraft("");
    void assistant.send(text);
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="AI Assistant"
        description="Ask about the club's work, or have the assistant draft a plan for you to check and confirm."
      />

      {loading && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading AI History…
        </p>
      )}
      {error && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load AI history: {error}. Refresh the page to try again.
        </p>
      )}
      {!loading && !error && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <Card className="shadow-none">
            <CardHeader>
              <h2 className="text-lg font-semibold tracking-tight">Conversation</h2>
              <p className="text-sm text-muted-foreground">
                Nothing changes until you confirm a plan.
              </p>
            </CardHeader>
            <CardContent className="grid gap-5">
              {history.length > 0 || turns.length > 0 ? (
                <ol className="grid gap-5">
                  {history.map((message) => (
                    <AssistantMessage key={message.id} message={message} />
                  ))}
                  {turns.map((turn) => (
                    <LiveTurn key={turn.id} turn={turn} />
                  ))}
                  {thinking && <ThinkingTurn />}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No conversation yet. Ask what&apos;s overdue, or to plan an event.
                </p>
              )}

              {staged && (
                <ProposalCard
                  key={staged.runId}
                  proposal={staged.proposal}
                  members={members.state.status === "ok" ? members.state.items : []}
                  onApply={(operations, stats) => void assistant.apply(operations, stats)}
                  onDiscard={assistant.discard}
                  busy={assistant.pending}
                />
              )}
              {assistant.error && (
                <p className="text-sm text-destructive" role="alert">
                  {assistant.error}
                </p>
              )}

              {assistant.state.status === "disabled" ? (
                <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
                  <PowerOff
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                  <div>
                    <h3 className="text-sm font-semibold">The assistant is switched off</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      This deployment has no AI service connected. Past conversations stay here.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="flex items-end gap-2">
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
                    className="min-h-10 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <Button type="submit" disabled={assistant.pending || !draft.trim()}>
                    <Send aria-hidden="true" />
                    Send
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit shadow-none">
            <CardHeader>
              <h2 className="text-lg font-semibold tracking-tight">Generated tasks</h2>
              <p className="text-sm text-muted-foreground">Tasks retaining assistant provenance.</p>
            </CardHeader>
            <CardContent>
              {generatedTasks.length > 0 ? (
                <ul className="grid gap-3">
                  {generatedTasks.map((task) => (
                    <GeneratedTask key={task.id} task={task} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                  No AI-generated tasks yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

/** A daily briefing is stored as its JSON (D15); anything that isn't one is plain text. */
function asBriefing(body: string): AiBriefing | undefined {
  if (!body.startsWith("{")) return undefined;
  try {
    const parsed = aiBriefingSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function MessageBody({ body }: { body: string }) {
  const briefing = asBriefing(body);
  if (!briefing) return <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{body}</p>;
  return (
    <div className="mt-2 text-sm leading-6">
      <p>{briefing.summary}</p>
      {briefing.bullets.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {briefing.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const assistant = Boolean(message.aiRunId);

  return (
    <li className={assistant ? "pr-6" : "pl-6"}>
      <article
        className={
          assistant
            ? "rounded-lg border bg-background p-4"
            : "rounded-lg bg-secondary p-4 text-secondary-foreground"
        }
      >
        <div className="flex items-center gap-2">
          {assistant && <Bot aria-hidden="true" className="size-4 text-muted-foreground" />}
          <h3 className="text-xs font-semibold">{assistant ? "MAC Assistant" : "You"}</h3>
          <time
            dateTime={message.createdAt.toISOString()}
            className="ml-auto text-xs text-muted-foreground"
          >
            {dateTime.format(message.createdAt)}
          </time>
        </div>
        <MessageBody body={message.body} />
      </article>
    </li>
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

/** A turn from this visit, shown before it is part of the stored history. */
function LiveTurn({ turn }: { turn: AssistantTurn }) {
  const fromAssistant = turn.role === "assistant";
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
        </div>
        <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{turn.text}</p>
      </article>
    </li>
  );
}

function GeneratedTask({ task }: { task: Task }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <span className="flex h-5 shrink-0 items-center">
          <PriorityDot priority={task.priority} />
        </span>
        <p className="text-sm leading-5 font-medium">{task.title}</p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <StatusBadge status={task.status} />
        <span className="text-xs text-muted-foreground capitalize">{task.priority} priority</span>
      </div>
    </li>
  );
}
