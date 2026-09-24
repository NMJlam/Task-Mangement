import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersPage } from "./members";

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "president@example.com",
      role: "president",
      tier: 2,
    },
  }),
}));

describe("MembersPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const member = {
    id: "018f3a4b-0000-7000-8000-000000000002",
    name: "Alex Morgan",
    email: "alex@example.com",
    role: "officer",
    tier: 0,
    teamIds: [],
    portfolio: null,
    createdAt: "2026-01-10T00:00:00.000Z",
  };

  it("renders the directory and confirms role changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ members: [member] }))
      .mockResolvedValueOnce(
        response({
          member: { id: member.id, role: "director", tier: 1, createdAt: member.createdAt },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<MembersPage />);

    await waitFor(() => expect(screen.getByText("Alex Morgan")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/role for alex morgan/i), {
      target: { value: "director" },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm role change/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/members/${member.id}/role`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("dismisses the role change modal back to the select that raised it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ members: [member] })));

    render(<MembersPage />);

    await waitFor(() => expect(screen.getByText("Alex Morgan")).toBeInTheDocument());
    const select = screen.getByLabelText(/role for alex morgan/i);
    fireEvent.change(select, { target: { value: "director" } });
    expect(screen.getByText("invite:create")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Radix restores focus to a `DialogTrigger`; this dialog opens from state,
    // so `MembersPage` hands it back explicitly. Without that the keyboard user
    // lands on `<body>` and has to tab in from the top of the page.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(select).toHaveFocus());
  });
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
