import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { authorise, authoriseCapability } from "./authorise.js";

function response() {
  const res = {} as Response & { statusCode?: number };
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  }) as Response["status"];
  res.json = vi.fn(() => res) as Response["json"];
  return res;
}

describe("authorisation", () => {
  it("rejects users below the required tier", () => {
    const req = { user: { tier: 0 } } as Request;
    const res = response();
    const next = vi.fn();

    authorise(1)(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("authoriseCapability", () => {
  it("rejects a treasurer from a president-only capability — tier 2 also admits them", () => {
    const req = { user: { role: "treasurer", tier: 2 } } as Request;
    const res = response();
    const next = vi.fn();

    authoriseCapability("event:cancel")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("admits a president to a president-only capability", () => {
    const req = { user: { role: "president", tier: 2 } } as Request;
    const res = response();
    const next = vi.fn();

    authoriseCapability("event:cancel")(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined();
  });
});
