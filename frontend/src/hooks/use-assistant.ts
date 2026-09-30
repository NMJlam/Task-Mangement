import {
  aiApplyResponseSchema,
  aiMessageResponseSchema,
  type AiApplyOperation,
  type AiApplyResponse,
  type AiResolvedProposal,
} from "@ctp/shared";
import { useCallback, useState } from "react";

export type AssistantTurn = { id: string; role: "member" | "assistant"; text: string };

/** The card on screen: one proposal at a time, applied against the run that drafted it. */
export type StagedProposal = { runId: string; proposal: AiResolvedProposal };

/**
 * `loading` and `error` never occur: the conversation starts empty and grows
 * as the member speaks — past runs are the page's own history read. `disabled`
 * is the deployment answering 503: the assistant is off, which is a state of
 * the page, not a failure of this request.
 */
type AssistantState =
  | { status: "loading" }
  | { status: "ok"; turns: AssistantTurn[]; staged?: StagedProposal }
  | { status: "error"; message: string }
  | { status: "disabled" };

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

let turnCount = 0;
const turn = (role: AssistantTurn["role"], text: string): AssistantTurn => ({
  id: `turn-${(turnCount += 1)}`,
  role,
  text,
});

/**
 * ViewModel for the assistant chat. `seed` is the event the page was opened
 * from (`/ai?eventId=…`); it rides along on every message so the assistant
 * keeps that event in view for the whole conversation.
 */
export function useAssistant(seed?: { eventId?: string }) {
  const [state, setState] = useState<AssistantState>({ status: "ok", turns: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const eventId = seed?.eventId;

  const append = useCallback(
    (next: AssistantTurn, staged?: StagedProposal | null) =>
      setState((current) =>
        current.status === "ok"
          ? {
              status: "ok",
              turns: [...current.turns, next],
              staged: staged === null ? undefined : (staged ?? current.staged),
            }
          : current,
      ),
    [],
  );

  const send = useCallback(
    async (text: string) => {
      setPending(true);
      setError(undefined);
      append(turn("member", text));
      try {
        const response = await fetch("/api/ai/messages", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, seed: eventId ? { eventId } : undefined }),
        });
        if (response.status === 503) {
          setState({ status: "disabled" });
          return;
        }
        if (!response.ok) {
          setError(await errorMessage(response, "The assistant couldn't answer. Try again."));
          return;
        }
        const body = aiMessageResponseSchema.parse(await response.json());
        // A new answer replaces any card still open: only the latest plan is live.
        append(
          turn("assistant", body.reply),
          body.proposal ? { runId: body.runId, proposal: body.proposal } : null,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The assistant couldn't answer.");
      } finally {
        setPending(false);
      }
    },
    [append, eventId],
  );

  const apply = useCallback(
    async (
      operations: AiApplyOperation[],
      stats: { proposed: number; kept: number; edited: number },
    ): Promise<AiApplyResponse | undefined> => {
      if (state.status !== "ok" || !state.staged) return undefined;
      setPending(true);
      setError(undefined);
      try {
        const response = await fetch("/api/ai/proposals/apply", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId: state.staged.runId, operations, stats }),
        });
        if (!response.ok) {
          setError(await errorMessage(response, "Nothing was applied. Try again."));
          return undefined;
        }
        const applied = aiApplyResponseSchema.parse(await response.json());
        const made = [
          applied.events.length &&
            `${applied.events.length} event${applied.events.length === 1 ? "" : "s"}`,
          applied.tasks.length &&
            `${applied.tasks.length} task${applied.tasks.length === 1 ? "" : "s"}`,
        ].filter(Boolean);
        append(turn("assistant", `Done — ${made.join(" and ") || "nothing"} saved.`), null);
        return applied;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Nothing was applied.");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [append, state],
  );

  const discard = useCallback(
    () =>
      setState((current) =>
        current.status === "ok" ? { ...current, staged: undefined } : current,
      ),
    [],
  );

  return { state, send, apply, discard, pending, error };
}
