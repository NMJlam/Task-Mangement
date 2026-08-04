import { exampleFormSchema } from "@ctp/shared";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { validate } from "./validate.js";

function mockRes() {
  const res = { locals: {} } as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("validate", () => {
  it("passes valid input through and exposes parsed data on res.locals", () => {
    const req = { body: { name: "Ada", email: "ada@example.com" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validate(exampleFormSchema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.validated).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("responds 422 with the shared ApiError shape on invalid input", () => {
    const req = { body: { name: "", email: "not-an-email" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validate(exampleFormSchema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
