import { mentionToken } from "@ctp/shared";

/**
 * The composer's draft: readable text, plus where each picked @mention sits in
 * it and whom it names.
 *
 * The wire format stays `@[user-id]` (`shared/messages/mentions.ts`): names are
 * not unique and change on rename, so the stored body carries ids. But an id is
 * no use to the person typing, so the box shows "@Glenn" and this model
 * remembers which characters ARE that mention. Only `serializeDraft`, building
 * the request body, turns them back into tokens.
 *
 * A mention exists only because it was picked from the list. Typing or pasting
 * "@Glenn" by hand is plain text, and nothing ever resolves a name to an id by
 * searching the roster — two members called Glenn stay two different people.
 *
 * Client-only, so it lives here rather than in `shared/`: the API never sees it.
 */

export interface MentionRange {
  start: number;
  end: number;
  userId: string;
  /** What the box showed when it was picked, "@Glenn" — frozen for the draft, so a rename mid-draft cannot quietly change whom the text names. */
  display: string;
}

export interface MentionDraft {
  text: string;
  /** In order, never overlapping. */
  mentions: readonly MentionRange[];
}

export interface Selection {
  start: number;
  end: number;
}

/** `[start, end)` of the old text replaced by `text`. A pure insertion has `start === end`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

export const EMPTY_DRAFT: MentionDraft = { text: "", mentions: [] };

/**
 * `draft` after `edit`. A mention wholly before the edit stays put, one wholly
 * after it moves by however much the text grew or shrank, and one the edit
 * reaches into stops being a mention — its characters stay, as plain text, so
 * an edited "@Glen" can never be sent as Glenn's id.
 *
 * Typing right at either edge of a mention leaves it whole: only an edit that
 * touches its characters invalidates it.
 */
export function applyEdit(draft: MentionDraft, edit: Edit): MentionDraft {
  const delta = edit.text.length - (edit.end - edit.start);
  const mentions: MentionRange[] = [];
  for (const mention of draft.mentions) {
    if (mention.end <= edit.start) {
      mentions.push(mention);
    } else if (mention.start >= edit.end) {
      mentions.push({ ...mention, start: mention.start + delta, end: mention.end + delta });
    }
  }
  return {
    text: draft.text.slice(0, edit.start) + edit.text + draft.text.slice(edit.end),
    mentions,
  };
}

/**
 * The edit that turned `before` into `after`.
 *
 * The selection just before the change says exactly where it happened —
 * `before.length - after.length` characters back from the caret for Backspace,
 * forward for Delete, the selected run for a replace or a paste — and that is
 * what keeps "delete the n inside @Glenn" apart from "delete the n after it",
 * which leave the same text. The browser does not always say (autofill, spell
 * correction, IME composition), so a selection that cannot explain the change
 * falls back to the smallest single edit between the two strings.
 */
export function inferEdit(
  before: string,
  after: string,
  selection?: Selection,
  inputType?: string,
): Edit {
  return (
    (selection && fromSelection(before, after, selection, inputType)) ?? diffEdit(before, after)
  );
}

function fits(before: string, after: string, edit: Edit): boolean {
  return (
    edit.start >= 0 &&
    edit.start <= edit.end &&
    edit.end <= before.length &&
    after === before.slice(0, edit.start) + edit.text + before.slice(edit.end)
  );
}

function fromSelection(
  before: string,
  after: string,
  { start, end }: Selection,
  inputType: string | undefined,
): Edit | undefined {
  const grown = after.length - before.length;
  let candidates: Edit[];
  if (start !== end) {
    const inserted = grown + (end - start);
    candidates = inserted >= 0 ? [{ start, end, text: after.slice(start, start + inserted) }] : [];
  } else if (grown > 0) {
    candidates = [{ start, end, text: after.slice(start, start + grown) }];
  } else if (grown < 0) {
    const backward = { start: start + grown, end: start, text: "" };
    const forward = { start, end: start - grown, text: "" };
    candidates = inputType?.endsWith("Forward") ? [forward, backward] : [backward, forward];
  } else {
    candidates = [];
  }
  return candidates.find((edit) => fits(before, after, edit));
}

/** The smallest single edit between two strings: their common prefix, then common suffix. */
export function diffEdit(before: string, after: string): Edit {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

/**
 * Puts a mention of `userId` over `range` — the "@partial" the list was opened
 * from — as "@label ", and says where the caret goes: after the space, so the
 * next word typed is not part of the name.
 */
export function insertMention(
  draft: MentionDraft,
  range: Selection,
  label: string,
  userId: string,
): { draft: MentionDraft; caret: number } {
  const display = `@${label}`;
  const edited = applyEdit(draft, { start: range.start, end: range.end, text: `${display} ` });
  const mention = { start: range.start, end: range.start + display.length, userId, display };
  return {
    draft: {
      text: edited.text,
      mentions: [...edited.mentions, mention].sort((a, b) => a.start - b.start),
    },
    caret: mention.end + 1,
  };
}

/** The mention whose characters include `index`, if any. */
export function mentionAt(draft: MentionDraft, index: number): MentionRange | undefined {
  return draft.mentions.find((mention) => mention.start <= index && index < mention.end);
}

/**
 * The body to POST: each mention as its `@[user-id]` token, every other
 * character — spaces, punctuation, line breaks — exactly as typed. Works from
 * the original offsets in one pass, so replacing one mention never shifts the
 * next. A range whose characters no longer read as it did when picked is sent
 * as the plain text it now is.
 */
export function serializeDraft(draft: MentionDraft): string {
  let body = "";
  let at = 0;
  for (const mention of draft.mentions) {
    if (mention.start < at || draft.text.slice(mention.start, mention.end) !== mention.display) {
      continue;
    }
    body += draft.text.slice(at, mention.start) + mentionToken(mention.userId);
    at = mention.end;
  }
  return body + draft.text.slice(at);
}

// ── History ──────────────────────────────────────────────────────────────────

/**
 * What the browser's own undo would put back is only the text: it knows
 * nothing of which "@Glenn" is a mention, and a picked mention is a
 * programmatic change its history does not even record. So the composer keeps
 * its own, with the mentions in each step, and Undo and Redo go through it.
 */
export type EditKind = "insert" | "delete" | "other" | "mention";

interface DraftSnapshot {
  draft: MentionDraft;
  /** Where the caret was, so undo puts it back too. */
  selection: Selection;
}

export interface DraftState {
  draft: MentionDraft;
  past: readonly DraftSnapshot[];
  future: readonly DraftSnapshot[];
  /** The last change recorded and where its caret ended, so a run of typing undoes as one step. */
  last?: { kind: EditKind; caret: number };
}

export const EMPTY_DRAFT_STATE: DraftState = { draft: EMPTY_DRAFT, past: [], future: [] };

const HISTORY_LIMIT = 100;

/**
 * `state` moved on to `next`. Typing continued from where the last keystroke
 * left the caret joins that keystroke's undo step, as does a run of Backspaces;
 * a space or line break closes the step, so undo goes back a word at a time.
 * Anything else — a paste, a cut, a picked mention — is a step of its own.
 */
export function recordEdit(
  state: DraftState,
  next: MentionDraft,
  change: { kind: EditKind; selectionBefore: Selection; caretAfter: number; inserted?: string },
): DraftState {
  const { kind, selectionBefore, caretAfter, inserted = "" } = change;
  const joins =
    (kind === "insert" || kind === "delete") &&
    state.last?.kind === kind &&
    state.last.caret === selectionBefore.start &&
    selectionBefore.start === selectionBefore.end;
  return {
    draft: next,
    past: joins
      ? state.past
      : [...state.past, { draft: state.draft, selection: selectionBefore }].slice(-HISTORY_LIMIT),
    future: [],
    last: { kind: /\s/.test(inserted) ? "other" : kind, caret: caretAfter },
  };
}

/** One step back, and where to put the caret; undefined when there is nothing to undo. */
export function undoDraft(
  state: DraftState,
  selection: Selection,
): { state: DraftState; selection: Selection } | undefined {
  const previous = state.past.at(-1);
  if (!previous) return undefined;
  return {
    state: {
      draft: previous.draft,
      past: state.past.slice(0, -1),
      future: [{ draft: state.draft, selection }, ...state.future],
    },
    selection: previous.selection,
  };
}

/** One step forward again, after an undo. */
export function redoDraft(
  state: DraftState,
  selection: Selection,
): { state: DraftState; selection: Selection } | undefined {
  const next = state.future[0];
  if (!next) return undefined;
  return {
    state: {
      draft: next.draft,
      past: [...state.past, { draft: state.draft, selection }],
      future: state.future.slice(1),
    },
    selection: next.selection,
  };
}
