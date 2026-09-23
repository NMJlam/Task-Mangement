import "./load-env.js";

export type AiConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  dailyRunCap: number;
};

/**
 * AI is opt-in per deployment (R14): the assistant sends club data to Google,
 * and AI Studio free-tier prompts may be retained, so the flag defaults to OFF
 * and every environment turns it on deliberately. See docs/setup.md.
 */
export function aiConfig(): AiConfig {
  return {
    enabled: process.env.AI_ENABLED === "1" && Boolean(process.env.GEMINI_API_KEY),
    apiKey: process.env.GEMINI_API_KEY ?? "",
    // Never a literal: free-tier model ids change, and a hard-coded one is an outage.
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    dailyRunCap: Number(process.env.AI_DAILY_RUN_CAP) || 50,
  };
}
