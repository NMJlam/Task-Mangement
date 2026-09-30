import "./load-env.js";

export type AiConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  dailyRunCap: number;
};

/**
 * The default model. `GEMINI_MODEL` overrides it with no code change, which is
 * the point — free-tier model names change, and a model that can only be changed
 * by editing code is an outage waiting to happen.
 *
 * Deliberately the small "lite" model rather than the newest flash: on the free
 * tier the newest model answers a share of calls with 503 "high demand" and
 * takes 4-40s when it does answer, and a chat turn is six calls in a row. The
 * lite model answered every probe in under a second, and the assistant's work
 * — picking a tool, filling in a form — does not need more.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * AI is opt-in per deployment (R14): the assistant sends club data to Google,
 * and AI Studio free-tier prompts may be retained, so the flag defaults to OFF
 * and every environment turns it on deliberately. See docs/setup.md.
 */
export function aiConfig(): AiConfig {
  return {
    enabled: process.env.AI_ENABLED === "1" && Boolean(process.env.GEMINI_API_KEY),
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    dailyRunCap: Number(process.env.AI_DAILY_RUN_CAP) || 50,
  };
}
