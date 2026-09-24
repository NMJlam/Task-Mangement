import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { RequireAuth } from "./require-auth";
import { LoginPage } from "@/routes/login";

const useAuth = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth", () => ({ useAuth }));

it("keeps the auth check stable while the session request is pending", () => {
  useAuth.mockReturnValue({
    account: null,
    isLoading: true,
    member: null,
    needsInvite: false,
    signOut: vi.fn(),
  });

  render(
    <MemoryRouter
      initialEntries={["/protected"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/protected" element={<RequireAuth>secret</RequireAuth>} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  expect(screen.queryByRole("button", { name: /sign in with google/i })).not.toBeInTheDocument();
});

it("hides capability-gated UI from roles without the capability", () => {
  useAuth.mockReturnValue({
    account: { id: "account" },
    isLoading: false,
    member: {
      id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
      email: "director@example.com",
      role: "director",
      tier: 1,
    },
    signOut: vi.fn(),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequireAuth capability="member:role-change">secret</RequireAuth>
    </MemoryRouter>,
  );

  expect(screen.queryByText("secret")).not.toBeInTheDocument();
  expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
});

it("tells a signed-in account without membership that it needs an invite", () => {
  useAuth.mockReturnValue({
    account: { id: "account" },
    isLoading: false,
    member: null,
    needsInvite: true,
    signOut: vi.fn(),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequireAuth>secret</RequireAuth>
    </MemoryRouter>,
  );

  expect(screen.queryByText("secret")).not.toBeInTheDocument();
  expect(screen.getByText(/need a club invite/i)).toBeInTheDocument();
});

it("does not blame a server error on a missing invite", () => {
  useAuth.mockReturnValue({
    account: { id: "account" },
    isLoading: false,
    member: null,
    needsInvite: false,
    signOut: vi.fn(),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequireAuth>secret</RequireAuth>
    </MemoryRouter>,
  );

  expect(screen.getByText(/unable to verify club membership/i)).toBeInTheDocument();
});

it("raises the step-down to officer as a modal, and reports a refusal inside it", async () => {
  const member = {
    id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
    email: "president@example.com",
    role: "president",
    tier: 2,
  };
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  useAuth.mockReturnValue({
    account: { id: "account" },
    isLoading: false,
    member,
    needsInvite: false,
    signOut: vi.fn(),
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequireAuth>secret</RequireAuth>
    </MemoryRouter>,
  );

  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Change president@example.com from President to Officer?",
  );
  fireEvent.click(screen.getByRole("button", { name: /confirm role change/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/members/${member.id}/role`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "officer" }) }),
    ),
  );
  // The refusal belongs next to the button that caused it, not behind the overlay.
  expect(await screen.findByRole("alert")).toHaveTextContent("Role change failed. Try again.");

  vi.unstubAllGlobals();
});
