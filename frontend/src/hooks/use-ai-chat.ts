import {
  aiChatMessagesResponseSchema,
  aiMessageResponseSchema,
  type AiApplyOperation,
  type AiChat,
  type AiChatMessage,
} from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { readAiError } from "@/lib/ai-errors";

/** What a new chat starts from: the event it was opened on, or today's briefing. */
export type ChatSeed = { eventId: string } | { briefing: true };

export type ApplyStats = { proposed: number; kept: number; edited: number };

/**
 * `blank` is `/ai` before anything is said: no chat exists yet, and none will
 * until a first message succeeds. `missing` is a chat that is not the member's
 * or has been deleted — the two are one answer from the server, on purpose.
 */
type ChatState =
  | { status: "blank" }
  | { status: "loading" }
  | { status: "ok"; chat: AiChat | undefined; messages: AiChatMessage[] }
  | { status: "missing" }
  | { status: "error"; message: string };

type Options = {
  /** Sent with the first message only; an existing chat already has its own. */
  seed?: ChatSeed;
  /** The first message made a chat: the page moves to its address. */
  onChatCreated?: (chatId: string) => void;
  /** Something the chat list shows has changed (a new chat, new activity). */
  onChanged?: () => void;
};

let localId = 0;
/** A message this browser put on screen itself, before or instead of reading it back. */
function localMessage(role: AiChatMessage["role"], body: string): AiChatMessage {
  return {
    id: `local-${(localId += 1)}`,
    role,
    body,
    createdAt: new Date(),
    runId: null,
    proposal: null,
    proposalStatus: null,
    applied: null,
  };
}

/**
 * ViewModel for one assistant chat: its messages, and the three things a
 * member does in it — send, apply a plan, discard a plan.
 */
export function useAiChat(chatId: string | undefined, options: Options = {}) {
  const [state, setState] = useState<ChatState>(
    chatId ? { status: "loading" } : { status: "blank" },
  );
  // What is being waited on. A reply and an apply both block the composer, but
  // only a reply shows the assistant thinking.
  const [waiting, setWaiting] = useState<"reply" | "plan">();
  const [error, setError] = useState<string>();
  const [disabled, setDisabled] = useState(false);

  // The chat this hook already holds in full. When a first message creates a
  // chat the page moves to /ai/:chatId, handing back the very id whose
  // messages are already on screen — refetching them would flash the page.
  const loadedFor = useRef<string | undefined>(undefined);
  // Read at call time, so a parent that passes fresh closures every render
  // does not re-run the effect below.
  const latest = useRef(options);
  latest.current = options;
  // Which conversation is on screen. It moves when the member opens another
  // chat or starts a new one — not when a first message turns the blank chat
  // into a saved one. That is the same conversation, and a follow-up typed
  // while its first reply was on the way belongs to it.
  const [conversation, setConversation] = useState(0);

  const load = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/ai/chats/${id}/messages`, { credentials: "include" });
      if (response.status === 404) {
        setState({ status: "missing" });
        return;
      }
      if (!response.ok) throw new Error("Failed to load this chat");
      const body = aiChatMessagesResponseSchema.parse(await response.json());
      loadedFor.current = id;
      setState({ status: "ok", chat: body.chat, messages: body.messages });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Failed to load this chat",
      });
    }
  }, []);

  useEffect(() => {
    if (!chatId) {
      loadedFor.current = undefined;
      setState({ status: "blank" });
      setConversation((current) => current + 1);
      return;
    }
    if (loadedFor.current === chatId) return;
    setConversation((current) => current + 1);
    setState({ status: "loading" });
    void load(chatId);
  }, [chatId, load]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const mine = localMessage("member", text);
      setWaiting("reply");
      setError(undefined);
      setState((current) =>
        current.status === "ok"
          ? { ...current, messages: [...current.messages, mine] }
          : { status: "ok", chat: undefined, messages: [mine] },
      );

      // Nothing was saved, so nothing stays on screen; the caller puts the text
      // back in the composer.
      const takeBack = () =>
        setState((current) => {
          if (current.status !== "ok") return current;
          const messages = current.messages.filter((message) => message.id !== mine.id);
          return messages.length === 0 && !chatId ? { status: "blank" } : { ...current, messages };
        });

      try {
        const response = await fetch("/api/ai/messages", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chatId ? { chatId, text } : { text, seed: latest.current.seed }),
        });
        if (!response.ok) {
          const failure = await readAiError(response, "The assistant couldn't answer. Try again.");
          if (response.status === 404) setState({ status: "missing" });
          else takeBack();
          if (failure.disabled) setDisabled(true);
          else setError(failure.message);
          return false;
        }
        const body = aiMessageResponseSchema.parse(await response.json());
        const seed = latest.current.seed;
        if (!chatId && seed && "briefing" in seed) {
          // A chat started from the briefing opens with it, and that first
          // message was written on the server — so this one chat is read back
          // rather than pieced together from what this browser saw.
          await load(body.chatId);
        } else {
          const reply: AiChatMessage = {
            ...localMessage("assistant", body.reply),
            runId: body.runId,
            proposal: body.proposal,
            proposalStatus: body.proposal ? "open" : null,
          };
          loadedFor.current = body.chatId;
          setState((current) =>
            current.status === "ok"
              ? { ...current, messages: [...current.messages, reply] }
              : current,
          );
        }
        if (!chatId) latest.current.onChatCreated?.(body.chatId);
        latest.current.onChanged?.();
        return true;
      } catch (cause) {
        takeBack();
        setError(cause instanceof Error ? cause.message : "The assistant couldn't answer.");
        return false;
      } finally {
        setWaiting(undefined);
      }
    },
    [chatId, load],
  );

  /** Apply and discard both change a plan's status; the chat is re-read to show it. */
  const settle = useCallback(
    async (request: () => Promise<Response>, fallback: string): Promise<boolean> => {
      const current = chatId ?? loadedFor.current;
      setWaiting("plan");
      setError(undefined);
      try {
        const response = await request();
        if (!response.ok) {
          const failure = await readAiError(response, fallback);
          if (failure.disabled) setDisabled(true);
          else setError(failure.message);
        }
        // Re-read either way: a refusal usually means the plan's status moved
        // on elsewhere, and the card should show where it really stands.
        if (current) await load(current);
        if (response.ok) latest.current.onChanged?.();
        return response.ok;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : fallback);
        return false;
      } finally {
        setWaiting(undefined);
      }
    },
    [chatId, load],
  );

  const apply = useCallback(
    (runId: string, operations: AiApplyOperation[], stats: ApplyStats) =>
      settle(
        () =>
          fetch("/api/ai/proposals/apply", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ runId, operations, stats }),
          }),
        "Nothing was applied. Try again.",
      ),
    [settle],
  );

  const discard = useCallback(
    (runId: string) =>
      settle(
        () =>
          fetch(`/api/ai/proposals/${runId}/discard`, { method: "POST", credentials: "include" }),
        "Couldn't discard the plan. Try again.",
      ),
    [settle],
  );

  return {
    state,
    conversation,
    send,
    apply,
    discard,
    pending: waiting !== undefined,
    thinking: waiting === "reply",
    error,
    disabled,
  };
}
