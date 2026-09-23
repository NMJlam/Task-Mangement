import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiOutputError, completeJson, extractJson } from "./service.js";

const schema = z.object({ ok: z.boolean() });

describe("extractJson", () => {
  it("passes bare JSON through", () => {
    expect(extractJson('{"ok":true}')).toBe('{"ok":true}');
  });

  it("unwraps a fenced block, which Gemini emits even when asked not to", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("unwraps an unlabelled fence", () => {
    expect(extractJson('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("strips prose before the object", () => {
    expect(extractJson('Sure! Here you go:\n{"ok":true}')).toBe('{"ok":true}');
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
});
