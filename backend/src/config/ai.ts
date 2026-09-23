import "./load-env.js";

export type AiConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  dailyRunCap: number;
};

/**
 * The documented default from the spec's config table. `GEMINI_MODEL` overrides
 * it with no code change, which is the point — free-tier model names change, and
 * a model that can only be changed by editing code is an outage waiting to happen.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

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
