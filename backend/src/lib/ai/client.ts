import { GoogleGenAI } from "@google/genai";
import { aiConfig, type AiConfig } from "../../config/ai.js";

/**
 * The seam. Services and tools take one of these as a parameter rather than
 * importing a provider, so unit tests pass a fake and `npm run test:unit` never
 * touches the network. Swapping Gemini out is a change to this file only.
 */
export type CompletionFn = (prompt: string) => Promise<string>;

/** 503 — this deployment has the assistant switched off, or has no key. */
export class AiDisabledError extends Error {
  constructor(message = "The assistant is not enabled on this deployment.") {
    super(message);
    this.name = "AiDisabledError";
  }
}

/** 429 — the daily cap is spent, or the provider rate-limited us. */
export class AiQuotaError extends Error {
  constructor(message = "The assistant has hit its usage limit. Try again later.") {
    super(message);
    this.name = "AiQuotaError";
  }
}

/** 503 — the assistant is on, but the provider could not answer just now. */
export class AiUnavailableError extends Error {
  constructor(message = "The AI service is busy right now. Try again in a moment.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** The slice of the SDK we use, so tests supply a double without the network. */
type GenAiLike = {
  models: {
    generateContent: (args: { model: string; contents: string }) => Promise<{ text?: string }>;
  };
};

/**
 * Waits before each retry. A chat turn is several model calls in a row — read,
 * read, propose, propose, reply — so one "high demand" 503 on any of them would
 * lose the whole turn. They usually clear within a second, which two short
 * waits cover.
 */
const RETRY_DELAYS_MS = [400, 1200];

/** The provider was reachable but could not serve this call; trying again can work. */
const BUSY_STATUSES = new Set([500, 502, 503, 504]);

const statusOf = (cause: unknown): number | undefined =>
  typeof cause === "object" &&
  cause !== null &&
  "status" in cause &&
  typeof cause.status === "number"
    ? cause.status
    : undefined;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function makeGeminiComplete(
  config: AiConfig,
  client?: GenAiLike,
  { sleep = realSleep }: { sleep?: (ms: number) => Promise<void> } = {},
): CompletionFn {
  return async (prompt: string): Promise<string> => {
    if (!config.enabled) throw new AiDisabledError();
    const genai: GenAiLike = client ?? new GoogleGenAI({ apiKey: config.apiKey });

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await genai.models.generateContent({
          model: config.model,
          contents: prompt,
        });
        return response.text ?? "";
      } catch (cause) {
        const status = statusOf(cause);
        // The free tier rate-limits aggressively; surface that as 429, not 500.
        // Not retried: the quota is spent, and asking again only spends more.
        if (status === 429) throw new AiQuotaError();
        // Anything else without a "busy" status is a bug or a bad config (a
        // retired model is 404) — a second attempt would not fix it.
        if (status === undefined || !BUSY_STATUSES.has(status)) throw cause;

        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) throw new AiUnavailableError();
        await sleep(delay);
      }
    }
  };
}

export const geminiComplete: CompletionFn = (prompt) => makeGeminiComplete(aiConfig())(prompt);
