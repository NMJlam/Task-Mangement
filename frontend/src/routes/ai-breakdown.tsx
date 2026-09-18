import type { Message, Task } from "@ctp/shared";
import { Bot, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { PriorityDot } from "@/components/common/priority-dot";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useTasks } from "@/hooks/use-tasks";
import { useThreadMessages, useThreads } from "@/hooks/use-threads";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AiBreakdownPage() {
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

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="AI Task Breakdown"
        description="Review assistant-generated plans and the tasks created from them."
        actions={
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            History only
          </span>
        }
      />

      <section
        aria-labelledby="ai-availability-heading"
        className="mt-6 flex items-start gap-3 rounded-xl border border-dashed bg-card p-4"
      >
        <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 id="ai-availability-heading" className="text-sm font-semibold">
            Planning is not connected yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This page shows saved assistant output. New breakdowns will be available when the AI
            service is connected.
          </p>
        </div>
      </section>

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
              <h2 className="text-lg font-semibold tracking-tight">Past breakdowns</h2>
              <p className="text-sm text-muted-foreground">The saved assistant conversation.</p>
            </CardHeader>
            <CardContent>
              {messages.state.status === "ok" && messages.state.items.length > 0 ? (
                <ol className="grid gap-5">
                  {[...messages.state.items].reverse().map((message) => (
                    <AssistantMessage key={message.id} message={message} />
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No saved breakdowns yet.
                </p>
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
        <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </article>
    </li>
  );
}

function GeneratedTask({ task }: { task: Task }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5">
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
