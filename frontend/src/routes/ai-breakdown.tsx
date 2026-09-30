import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChatList } from "@/components/ai/chat-list";
import { ChatThread } from "@/components/ai/chat-thread";
import { GeneratedPanel } from "@/components/ai/generated-panel";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useAiChat } from "@/hooks/use-ai-chat";
import { useAiChats } from "@/hooks/use-ai-chats";
import { useMembers } from "@/hooks/use-members";

const GENERATED_PANEL_ID = "ai-generated-panel";

/**
 * AI Breakdown: the member's assistant chats beside the open one, laid out like
 * Messages. `/ai` is a blank chat — nothing is saved until its first message
 * succeeds — and `/ai/:chatId` is one that exists. The address carries the
 * chat, so a reload or a shared link lands where the member was.
 */
export function AiBreakdownPage() {
  const { chatId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get("eventId") ?? undefined;
  const members = useMembers();
  const chats = useAiChats();
  const [notice, setNotice] = useState<string>();
  const [showGenerated, setShowGenerated] = useState(false);
  const chat = useAiChat(chatId, {
    // From an event's "Plan with AI" link: the new chat is about that event.
    seed: eventId ? { eventId } : undefined,
    onChatCreated: (id) => navigate(`/ai/${id}`, { replace: true }),
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

      <div className="mt-8 grid min-h-[36rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col">
          <ChatList
            chats={items}
            activeId={chatId}
            onRename={(target, title) => void chats.rename(target, title)}
            onRemove={(target) =>
              void chats.remove(target).then((removed) => {
                if (removed && target.id === chatId) navigate("/ai");
              })
            }
          />
          {chats.state.status === "loading" && (
            <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
              Loading chats…
            </p>
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

        <ChatThread
          chatKey={chatId}
          title={open?.title ?? "New chat"}
          seedEventId={open?.seedEventId ?? null}
          messages={chat.state.status === "ok" ? chat.state.messages : []}
          loading={chat.state.status === "loading"}
          thinking={chat.thinking}
          pending={chat.pending}
          error={
            chat.error ?? (chat.state.status === "error" ? chat.state.message : undefined) ?? notice
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
              onClick={() => setShowGenerated((open) => !open)}
            >
              <ListChecks aria-hidden="true" />
              Generated
            </Button>
          }
        >
          {showGenerated && <GeneratedPanel id={GENERATED_PANEL_ID} />}
        </ChatThread>
      </div>
    </main>
  );
}
