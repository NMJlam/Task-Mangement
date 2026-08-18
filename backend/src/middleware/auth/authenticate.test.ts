import type { Request, Response } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { authenticate } from "./authenticate.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../../auth/auth.js", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("../../db/client.js", () => ({
  getDb: () => ({
    execute: mocks.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
  }),
}));

function response() {
  const res = {} as Response & { statusCode?: number };
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  }) as Response["status"];
  res.json = vi.fn(() => res) as Response["json"];
  return res;
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getSession.mockReset();
  mocks.limit.mockReset();
});

it("rejects requests without a session", async () => {
  mocks.getSession.mockResolvedValue(null);
  const res = response();
  const next = vi.fn();

  await authenticate({ headers: {} } as Request, res, next);

  expect(res.statusCode).toBe(401);
  expect(res.json).toHaveBeenCalledWith({
    error: { code: "UNAUTHENTICATED", message: "Sign-in required." },
  });
  expect(next).not.toHaveBeenCalled();
});

it("rejects a verified account without an invite", async () => {
  mocks.getSession.mockResolvedValue({
    user: { id: "account-id", email: "member@example.com", emailVerified: true },
  });
  mocks.limit.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ rows: [] });
  const res = response();
  const next = vi.fn();

  await authenticate({ headers: {} } as Request, res, next);

  expect(mocks.limit).toHaveBeenCalledOnce();
  expect(res.statusCode).toBe(403);
  expect(res.json).toHaveBeenCalledWith({
    error: { code: "NO_MEMBERSHIP", message: "Club membership required." },
  });
  expect(next).not.toHaveBeenCalled();
});

it("does not claim an invite for an unverified email", async () => {
  mocks.getSession.mockResolvedValue({
    user: { id: "account-id", email: "member@example.com", emailVerified: false },
  });
  mocks.limit.mockResolvedValue([]);
  const res = response();
  const next = vi.fn();

  await authenticate({ headers: {} } as Request, res, next);

  expect(mocks.execute).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(403);
  expect(res.json).toHaveBeenCalledWith({
    error: { code: "NO_MEMBERSHIP", message: "Club membership required." },
  });
  expect(next).not.toHaveBeenCalled();
});

it("claims an invite before authorising a verified account", async () => {
  const membership = {
    id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
    authUserId: "account-id",
    role: "officer" as const,
    tier: 0 as const,
    createdAt: new Date(),
  };
  mocks.getSession.mockResolvedValue({
    user: { id: "account-id", email: "member@example.com", emailVerified: true },
  });
  mocks.limit.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ rows: [membership] });
  const req = { headers: {} } as Request;
  const res = response();
  const next = vi.fn();

  await authenticate(req, res, next);

  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(mocks.limit).toHaveBeenCalledOnce();
  expect(req.user).toMatchObject({ id: membership.id, email: "member@example.com" });
  expect(next).toHaveBeenCalledOnce();
});
