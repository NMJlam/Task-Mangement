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

/** The slice of the SDK we use, so tests supply a double without the network. */
type GenAiLike = {
  models: {
    generateContent: (args: { model: string; contents: string }) => Promise<{ text?: string }>;
  };
};

export function makeGeminiComplete(config: AiConfig, client?: GenAiLike): CompletionFn {
  return async (prompt: string): Promise<string> => {
    if (!config.enabled) throw new AiDisabledError();
    const genai: GenAiLike = client ?? new GoogleGenAI({ apiKey: config.apiKey });
    try {
      const response = await genai.models.generateContent({
        model: config.model,
        contents: prompt,
      });
      return response.text ?? "";
    } catch (cause) {
      // The free tier rate-limits aggressively; surface that as 429, not 500.
      if (
        typeof cause === "object" &&
        cause !== null &&
        "status" in cause &&
        cause.status === 429
      ) {
        throw new AiQuotaError();
      }
      throw cause;
    }
  };
}

export const geminiComplete: CompletionFn = (prompt) => makeGeminiComplete(aiConfig())(prompt);
