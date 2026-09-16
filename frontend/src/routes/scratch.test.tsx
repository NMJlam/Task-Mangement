import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScratchPage } from "./scratch";

const useSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  authClient: {
    useSession,
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

beforeEach(() => {
  useSession.mockReturnValue({ data: { user: { email: "dev@example.com" } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sends the chosen method, path and body, then reports the status", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ status: 201, text: async () => '{"team":{"id":"t1"}}' });
  vi.stubGlobal("fetch", fetchMock);

  render(<ScratchPage />);
  fireEvent.change(screen.getByLabelText(/method/i), { target: { value: "POST" } });
  fireEvent.change(screen.getByLabelText(/path/i), { target: { value: "/api/teams" } });
  fireEvent.change(screen.getByLabelText(/json body/i), { target: { value: '{"name":"Media"}' } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Response 201")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/teams",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: '{"name":"Media"}',
    }),
  );
});

it("never attaches a leftover body to a GET", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" });
  vi.stubGlobal("fetch", fetchMock);

  render(<ScratchPage />);
  fireEvent.change(screen.getByLabelText(/json body/i), { target: { value: '{"name":"Media"}' } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Response 200")).toBeInTheDocument());
  expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
});

it("shows a failed request instead of rendering nothing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));

  render(<ScratchPage />);
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Request failed")).toBeInTheDocument());
  expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
});

it("reveals and re-hides the password", () => {
  useSession.mockReturnValue({ data: null });

  render(<ScratchPage />);
  const password = screen.getByLabelText("Password");
  expect(password).toHaveAttribute("type", "password");

  fireEvent.click(screen.getByRole("button", { name: /show password/i }));
  expect(password).toHaveAttribute("type", "text");

  fireEvent.click(screen.getByRole("button", { name: /hide password/i }));
  expect(password).toHaveAttribute("type", "password");
});

it("omits the body when the textarea is empty", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 204, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);

  render(<ScratchPage />);
  fireEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(screen.getByText("Response 204")).toBeInTheDocument());
  expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  expect(screen.getByText("(empty body)")).toBeInTheDocument();
});
