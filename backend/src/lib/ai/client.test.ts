import { describe, expect, it, vi } from "vitest";
import { AiDisabledError, AiQuotaError, makeGeminiComplete } from "./client.js";

const config = { enabled: true, apiKey: "k", model: "gemini-2.5-flash", dailyRunCap: 50 };

describe("makeGeminiComplete", () => {
  it("throws AiDisabledError when the deployment has AI switched off", async () => {
    const complete = makeGeminiComplete({ ...config, enabled: false });
    await expect(complete("hi")).rejects.toBeInstanceOf(AiDisabledError);
  });

  it("returns the model's text and sends the configured model id", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"ok":true}' });
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).resolves.toBe('{"ok":true}');
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-flash", contents: "hi" }),
    );
  });

  it("returns an empty string when the model returns no text", async () => {
    const generateContent = vi.fn().mockResolvedValue({});
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).resolves.toBe("");
  });

  it("maps a provider 429 to AiQuotaError", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).rejects.toBeInstanceOf(AiQuotaError);
  });

  it("rethrows any other provider failure unchanged", async () => {
    const boom = new Error("network down");
    const generateContent = vi.fn().mockRejectedValue(boom);
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).rejects.toBe(boom);
  });
});
