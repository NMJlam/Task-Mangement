import { aiChatListResponseSchema, aiChatResponseSchema, type AiChat } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { readAiError } from "@/lib/ai-errors";

type ChatsState =
  { status: "loading" } | { status: "ok"; items: AiChat[] } | { status: "error"; message: string };

async function fetchChats(): Promise<AiChat[]> {
  const response = await fetch("/api/ai/chats", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load your chats");
  return aiChatListResponseSchema.parse(await response.json()).chats;
}

/**
 * ViewModel for the member's list of assistant chats. The list is theirs alone
 * and the server orders it by last activity, so `refresh` after a message is
 * what moves a chat to the top and brings in one that was just created.
 */
export function useAiChats() {
  const [state, setState] = useState<ChatsState>({ status: "loading" });
  const [mutationError, setMutationError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const items = await fetchChats();
      setState({ status: "ok", items });
    } catch (cause) {
      // A failed refresh keeps whatever list is already on screen.
      setState((current) =>
        current.status === "ok"
          ? current
          : {
              status: "error",
              message: cause instanceof Error ? cause.message : "Failed to load your chats",
            },
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rename = useCallback(async (chat: AiChat, title: string) => {
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/ai/chats/${chat.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        setMutationError((await readAiError(response, "Couldn't rename the chat")).message);
        return false;
      }
      const renamed = aiChatResponseSchema.parse(await response.json()).chat;
      setState((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: current.items.map((item) => (item.id === renamed.id ? renamed : item)),
            }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Couldn't rename the chat");
      return false;
    }
  }, []);

  const remove = useCallback(async (chat: AiChat) => {
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/ai/chats/${chat.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      // 204: no body to read, so the local list IS the record of the delete.
      if (!response.ok) {
        setMutationError((await readAiError(response, "Couldn't delete the chat")).message);
        return false;
      }
      setState((current) =>
        current.status === "ok"
          ? { ...current, items: current.items.filter((item) => item.id !== chat.id) }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Couldn't delete the chat");
      return false;
    }
  }, []);

  return { state, refresh, rename, remove, mutationError };
}
