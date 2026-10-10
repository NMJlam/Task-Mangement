import { MESSAGE_BODY_MAX, type Message } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { useThreadMessages } from "@/hooks/use-threads";
import { EMPTY_DRAFT_STATE, serializeDraft, type DraftState } from "@/lib/mention-draft";

/**
 * ViewModel for one conversation's chat pane: its messages, the search over
 * them, and the draft being written. Messages and an event's Thread tab both
 * render it through `ThreadChat`.
 *
 * - `onSent` hears about each message once it is stored — Messages uses it to
 *   move the conversation to the top of its list.
 * - `onDeleted` hears about each message deleted from here — Messages re-reads
 *   its unread counts, the event page checks its summary still stands.
 * - `onGone` hears when the server stops showing the conversation (deleted, or
 *   access lost) — Messages re-reads its list, which no longer has it.
 *
 * The draft is a `DraftState` (`lib/mention-draft.ts`): the text the box shows,
 * which characters are picked @mentions and whom they name, and its own undo
 * history. Only `send` turns it into the body the API stores.
 */
export function useThreadChat(
  threadId: string | undefined,
  {
    onSent,
    onDeleted,
    onGone,
  }: {
    onSent?: (message: Message) => void;
    onDeleted?: (message: Message) => void;
    onGone?: (threadId: string) => void;
  } = {},
) {
  const [draft, setDraftState] = useState<DraftState>(EMPTY_DRAFT_STATE);
  const [draftError, setDraftError] = useState<string>();
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // The conversation the draft and search above were typed in.
  const [typedIn, setTypedIn] = useState<string>();

  // A draft and a search belong to the conversation they were typed in —
  // switching should never carry half a message, or whom it mentions, into the
  // wrong one. Settled while rendering, not in an effect: an effect runs only
  // after the new conversation is on screen, and anything typed in between
  // would be wiped by a reset that arrived late.
  if (typedIn !== threadId) {
    setTypedIn(threadId);
    setDraftState(EMPTY_DRAFT_STATE);
    setDraftError(undefined);
    setSearchInput("");
    setSearchQuery("");
  }

  const messages = useThreadMessages(threadId, searchQuery, { onGone });

  // Debounced so every keystroke doesn't fire a request — the search is
  // server-side (the thread can hold far more than one loaded page).
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /** A change to the draft also clears a complaint about the last version of it. */
  const setDraft = useCallback((next: DraftState) => {
    setDraftState(next);
    setDraftError(undefined);
  }, []);

  function send() {
    const body = serializeDraft(draft.draft).trim();
    // Enter submits through `requestSubmit()`, which a disabled Send button
    // does not stop — so a second Enter mid-send would post a duplicate.
    if (!body || messages.sending) return;
    // Measured as SENT: each mention travels as its id token, longer than the
    // name on screen, so a draft under the box's limit can still be over the
    // API's. Say so, and keep every word of it.
    if (body.length > MESSAGE_BODY_MAX) {
      setDraftError(
        `This message is ${body.length} characters once its mentions are included — the limit is ${MESSAGE_BODY_MAX}. Shorten it to send.`,
      );
      return;
    }
    // `send` only answers with the message while the reader is still on the
    // visit it was sent from, so a slow send never clears a draft typed since
    // in another thread — or in this one after leaving and coming back. A
    // failed send answers nothing, so the draft and its mentions stay.
    const sentDraft = draft;
    void messages.send(body).then((sent) => {
      if (!sent) return;
      // Only the draft that was sent. Anything typed after Enter — the next
      // message, already being written while this one was in flight — stays.
      setDraftState((current) => (current === sentDraft ? EMPTY_DRAFT_STATE : current));
      if (!sent.deletedAt) onSent?.(sent);
    });
  }

  async function deleteMessage(message: Message): Promise<boolean> {
    const tombstone = await messages.deleteMessage(message);
    if (tombstone) onDeleted?.(tombstone);
    return tombstone !== undefined;
  }

  return {
    threadId,
    messages,
    draft,
    setDraft,
    draftError,
    searchInput,
    setSearchInput,
    searchQuery,
    send,
    deleteMessage,
  };
}

export type ThreadChatModel = ReturnType<typeof useThreadChat>;
