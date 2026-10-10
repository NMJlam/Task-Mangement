import type { Message } from "@ctp/shared";

/** How long after the message before it a message may still continue its run. */
export const CONTINUATION_MS = 5 * 60 * 1000;

/**
 * Whether each message — oldest first, as the chat draws them — carries on the
 * run of the one before it, and so is drawn without its own avatar and name.
 * Purely visual: every message keeps its own row, id, time and actions, and
 * nothing here merges or hides one.
 *
 * Worked out over the whole array each render, so loading an older page can
 * turn the first row that was showing into a continuation of the page above.
 *
 * In search results every message stands alone: the messages a search left
 * out between two hits are exactly what would make them look adjacent.
 */
export function continuations(
  messages: readonly Message[],
  { searching }: { searching: boolean },
): boolean[] {
  return messages.map(
    (message, index) => !searching && index > 0 && continues(messages[index - 1]!, message),
  );
}

/** One run is one sender, saying one thing after another, in one place. */
export function continues(previous: Message, message: Message): boolean {
  // A former member's messages all have a null author; that is no evidence
  // they were the same person.
  if (message.author === null || previous.author !== message.author) return false;
  // The assistant posts under the member who ran it, so the run id is part of
  // who is speaking: a human and the assistant never share a header, and nor
  // do two separate assistant runs.
  if (previous.aiRunId !== message.aiRunId) return false;
  if (
    previous.channelId !== message.channelId ||
    previous.taskId !== message.taskId ||
    previous.parentId !== message.parentId
  ) {
    return false;
  }
  // A deleted message stands alone, and breaks the run on both sides.
  if (previous.deletedAt !== null || message.deletedAt !== null) return false;
  if (attachmentOnly(previous) || attachmentOnly(message)) return false;

  const gap = message.createdAt.getTime() - previous.createdAt.getTime();
  return gap >= 0 && gap <= CONTINUATION_MS && sameLocalDay(previous.createdAt, message.createdAt);
}

function attachmentOnly(message: Message): boolean {
  return message.fileKey !== null && message.body === "";
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
