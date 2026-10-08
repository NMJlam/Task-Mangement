import { ListChecks, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BriefingPanel } from "@/components/ai/briefing-panel";
import { ChatList } from "@/components/ai/chat-list";
import { ChatThread } from "@/components/ai/chat-thread";
import { GeneratedPanel } from "@/components/ai/generated-panel";
import { LoadingLine } from "@/components/common/loading-line";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useAiChat, type ChatSeed } from "@/hooks/use-ai-chat";
import { useAiChats } from "@/hooks/use-ai-chats";
import { useBriefing } from "@/hooks/use-briefing";
import { useMembers } from "@/hooks/use-members";
import { cn } from "@/lib/utils";

const GENERATED_PANEL_ID = "ai-generated-panel";

/**
 * AI Breakdown: the member's assistant chats beside the open one, laid out like
 * Messages. `/ai` is a blank chat — nothing is saved until its first message
 * succeeds — `/ai/:chatId` is one that exists, and `/ai/briefing` is today's
 * briefing pinned above the chats. The address carries what is open, so a
 * reload or a shared link lands where the member was.
 */
export function AiBreakdownPage({ view }: { view?: "briefing" }) {
  const { chatId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get("eventId") ?? undefined;
  const members = useMembers();
  const chats = useAiChats();
  const briefing = useBriefing();
  const [notice, setNotice] = useState<string>();
  const [showGenerated, setShowGenerated] = useState(false);
  const onBriefing = view === "briefing";
  // What a new chat starts from: today's briefing when asked from it, or the
  // event behind an event page's "Plan with AI" link.
  const seed: ChatSeed | undefined = onBriefing
    ? { briefing: true }
    : eventId
      ? { eventId }
      : undefined;
  const chat = useAiChat(onBriefing ? undefined : chatId, {
    seed,
    onChatCreated: (id) => navigate(`/ai/${id}`, { replace: !onBriefing }),
    onChanged: () => void chats.refresh(),
  });

  // A chat that is gone — deleted in another tab, or never the member's — is
  // said once, and the page falls back to a blank chat rather than a dead end.
  const missing = chat.state.status === "missing";
  useEffect(() => {
    if (!missing) return;
    setNotice("This chat no longer exists.");
    navigate("/ai", { replace: true });
  }, [missing, navigate]);
  useEffect(() => {
    if (chatId) setNotice(undefined);
  }, [chatId]);

  const items = chats.state.status === "ok" ? chats.state.items : [];
  const open =
    items.find((item) => item.id === chatId) ??
    (chat.state.status === "ok" ? chat.state.chat : undefined);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="AI Assistant"
        description="Ask about the club's work, or have the assistant draft a plan for you to check and confirm."
      />

      {/* Stacked on a phone, the chat strip keeps its own height and the open
          chat takes the rest of the minimum, rather than the two sharing it. */}
      <div className="mt-8 grid min-h-[36rem] grid-rows-[auto_1fr] overflow-hidden rounded-xl border bg-card lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-none">
        {/* The column, not the list, carries the divider: the list is only as
            tall as its chats, and the divider should run the full height. */}
        <div className="flex min-w-0 flex-col border-b lg:border-r lg:border-b-0">
          <ChatList
            chats={items}
            activeId={onBriefing ? undefined : chatId}
            onRename={(target, title) => void chats.rename(target, title)}
            onRemove={(target) =>
              void chats.remove(target).then((removed) => {
                if (removed && target.id === chatId) navigate("/ai");
              })
            }
            pinned={
              briefing.state.status === "disabled" ? undefined : (
                <Link
                  to="/ai/briefing"
                  aria-current={onBriefing ? "page" : undefined}
                  className={cn(
                    "flex min-w-48 shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground lg:mb-3 lg:w-full lg:min-w-0 lg:border-b lg:pb-3",
                    onBriefing && "bg-accent font-medium text-accent-foreground",
                  )}
                >
                  <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  Today&apos;s briefing
                </Link>
              )
            }
          />
          {chats.state.status === "loading" && (
            <LoadingLine label="Loading chats…" className="px-4 py-3" />
          )}
          {chats.state.status === "error" && (
            <p className="px-4 py-3 text-sm text-destructive">
              Couldn&apos;t load your chats: {chats.state.message}.
            </p>
          )}
          {chats.mutationError && (
            <p className="px-4 py-3 text-sm text-destructive">{chats.mutationError}</p>
          )}
        </div>

        {onBriefing ? (
          <BriefingPanel
            state={briefing.state}
            retry={briefing.retry}
            onAsk={chat.send}
            pending={chat.pending}
            error={chat.error}
          />
        ) : (
          <ChatThread
            chatKey={chat.conversation}
            title={open?.title ?? "New chat"}
            seedEventId={open?.seedEventId ?? null}
            messages={chat.state.status === "ok" ? chat.state.messages : []}
            loading={chat.state.status === "loading"}
            thinking={chat.thinking}
            pending={chat.pending}
            error={
              chat.error ??
              (chat.state.status === "error" ? chat.state.message : undefined) ??
              notice
            }
            disabled={chat.disabled}
            members={members.state.status === "ok" ? members.state.items : []}
            onSend={(text) => {
              setNotice(undefined);
              return chat.send(text);
            }}
            onApply={(runId, operations, stats) => void chat.apply(runId, operations, stats)}
            onDiscard={(runId) => void chat.discard(runId)}
            headerActions={
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showGenerated}
                aria-controls={GENERATED_PANEL_ID}
                onClick={() => setShowGenerated((shown) => !shown)}
              >
                <ListChecks aria-hidden="true" />
                Generated
              </Button>
            }
          >
            {showGenerated && <GeneratedPanel id={GENERATED_PANEL_ID} />}
          </ChatThread>
        )}
      </div>
    </main>
  );
}
