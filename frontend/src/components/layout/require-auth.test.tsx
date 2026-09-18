import { render, screen } from "@testing-library/react";
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
