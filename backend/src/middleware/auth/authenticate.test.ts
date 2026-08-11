import type { Request, Response } from "express";
import { expect, it, vi } from "vitest";
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
  mocks.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([membership]);
  mocks.execute.mockResolvedValue({ rows: [] });
  const req = { headers: {} } as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  const next = vi.fn();

  await authenticate(req, res, next);

  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(req.user).toMatchObject({ id: membership.id, email: "member@example.com" });
  expect(next).toHaveBeenCalledOnce();
});
