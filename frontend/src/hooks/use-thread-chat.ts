import type { Message } from "@ctp/shared";
import { useEffect, useState } from "react";
import { useThreadMessages } from "@/hooks/use-threads";

/**
 * ViewModel for one conversation's chat pane: its messages, the search over
 * them, and the draft being written. Messages and an event's Thread tab both
 * render it through `ThreadChat`.
 *
 * `onSent` hears about each message once it is stored — Messages uses it to
 * move the conversation to the top of its list.
 */
export function useThreadChat(threadId: string | undefined, onSent?: (message: Message) => void) {
  const [draft, setDraft] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // The conversation the draft and search above were typed in.
  const [typedIn, setTypedIn] = useState<string>();

  // A draft and a search belong to the conversation they were typed in —
  // switching should never carry half a message into the wrong one. Settled
  // while rendering, not in an effect: an effect runs only after the new
  // conversation is on screen, and anything typed in between would be wiped
  // by a reset that arrived late.
  if (typedIn !== threadId) {
    setTypedIn(threadId);
    setDraft("");
    setSearchInput("");
    setSearchQuery("");
  }

  const messages = useThreadMessages(threadId, searchQuery);

  // Debounced so every keystroke doesn't fire a request — the search is
  // server-side (the thread can hold far more than one loaded page).
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function send() {
    const body = draft.trim();
    // Enter submits through `requestSubmit()`, which a disabled Send button
    // does not stop — so a second Enter mid-send would post a duplicate.
    if (!body || messages.sending) return;
    // `send` only answers with the message while the reader is still on the
    // visit it was sent from, so a slow send never clears a draft typed since
    // in another thread — or in this one after leaving and coming back.
    void messages.send(body).then((sent) => {
      if (!sent) return;
      setDraft("");
      onSent?.(sent);
    });
  }

  return { messages, draft, setDraft, searchInput, setSearchInput, searchQuery, send };
}

export type ThreadChatModel = ReturnType<typeof useThreadChat>;
