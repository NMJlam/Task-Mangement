import { describe, expect, it, vi } from "vitest";
import { AiDisabledError, AiQuotaError, AiUnavailableError, makeGeminiComplete } from "./client.js";

const config = { enabled: true, apiKey: "k", model: "gemini-3.5-flash-lite", dailyRunCap: 50 };

/** What the provider throws: an error carrying the HTTP status it answered with. */
const providerError = (status: number) =>
  Object.assign(new Error(`provider ${status}`), { status });
/** No real waiting in a unit test: the backoff is recorded, not slept. */
const noSleep = { sleep: vi.fn().mockResolvedValue(undefined) };

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
      expect.objectContaining({ model: "gemini-3.5-flash-lite", contents: "hi" }),
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

  it("retries a call the provider says it was too busy for, and returns the answer", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(providerError(503))
      .mockResolvedValueOnce({ text: "second time lucky" });
    const complete = makeGeminiComplete(config, { models: { generateContent } }, noSleep);

    await expect(complete("hi")).resolves.toBe("second time lucky");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash-lite" }),
    );
  });

  it("gives up with AiUnavailableError once the provider has stayed busy through every retry", async () => {
    const generateContent = vi.fn().mockRejectedValue(providerError(503));
    const complete = makeGeminiComplete(config, { models: { generateContent } }, noSleep);

    await expect(complete("hi")).rejects.toBeInstanceOf(AiUnavailableError);
    // The first call plus two retries — no more, or a stuck provider would stall the member.
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("does not retry a retired model: a 404 will not fix itself", async () => {
    const retired = providerError(404);
    const generateContent = vi.fn().mockRejectedValue(retired);
    const complete = makeGeminiComplete(config, { models: { generateContent } }, noSleep);

    await expect(complete("hi")).rejects.toBe(retired);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
