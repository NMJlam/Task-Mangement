import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiQuotaError } from "../../lib/ai/client.js";
import { AiOutputError, completeJson, extractJson } from "./service.js";

const schema = z.object({ ok: z.boolean() });

describe("extractJson", () => {
  it("passes bare JSON through", () => {
    expect(extractJson('{"ok":true}')).toEqual(['{"ok":true}']);
  });

  it("unwraps a fenced block, which Gemini emits even when asked not to", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual(['{"ok":true}']);
  });

  it("unwraps an unlabelled fence", () => {
    expect(extractJson('```\n{"ok":true}\n```')).toEqual(['{"ok":true}']);
  });

  it("strips prose before the object", () => {
    expect(extractJson('Sure! Here you go:\n{"ok":true}')).toEqual(['{"ok":true}']);
  });

  it("returns every fenced block as a separate candidate, in order, not just the first", () => {
    const raw =
      'Format looks like:\n```json\n{"note":"draft"}\n```\n' +
      'My actual answer:\n```json\n{"ok":true}\n```';
    expect(extractJson(raw).slice(0, 2)).toEqual(['{"note":"draft"}', '{"ok":true}']);
  });
});

describe("completeJson", () => {
  it("returns the parsed value on the first attempt", async () => {
    const complete = vi.fn().mockResolvedValue('{"ok":true}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response does not satisfy the schema", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"ok":false}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("fails closed after two bad responses, so a partial write is impossible", async () => {
    const complete = vi.fn().mockResolvedValue("still not json");
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("finds the real object when an illustrative fence precedes it, with no retry needed", async () => {
    const raw =
      'Format looks like:\n```json\n{"note":"draft"}\n```\n' +
      'My actual answer:\n```json\n{"ok":true}\n```';
    const complete = vi.fn().mockResolvedValue(raw);
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("still resolves a response with only a single fence", async () => {
    const complete = vi.fn().mockResolvedValue('```json\n{"ok":true}\n```');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("fails closed on prose containing braces that are not a JSON object", async () => {
    const complete = vi.fn().mockResolvedValue("The value of x is {unknown} and y is {2}");
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("fails closed on two bare JSON objects with no fence to tell them apart", async () => {
    const complete = vi.fn().mockResolvedValue('{"ok":true}\n{"ok":false}');
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("propagates a rejection from complete rather than swallowing it into AiOutputError", async () => {
    const complete = vi.fn().mockRejectedValue(new AiQuotaError());
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiQuotaError);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
