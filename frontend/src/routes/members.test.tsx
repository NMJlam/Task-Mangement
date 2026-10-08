import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersPage } from "./members";

const viewer = vi.hoisted(() => ({
  id: "018f3a4b-0000-7000-8000-000000000001",
  email: "president@example.com",
  role: "president",
  tier: 2,
}));

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({ status: "ok", user: viewer }),
}));

describe("MembersPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(viewer, { role: "president", tier: 2 });
  });

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

  const media = {
    id: "018f3a4b-0000-7000-8000-0000000000a1",
    name: "Media",
    lead: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    memberIds: [member.id],
  };
  const marketing = {
    id: "018f3a4b-0000-7000-8000-0000000000a2",
    name: "Marketing",
    lead: viewer.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    memberIds: [],
  };

  /**
   * Routes by URL: the page reads the roster and the teams side by side, so an
   * ordered queue of responses would hand one read the other's body.
   */
  function stubApi(
    writes: Record<string, unknown> = {},
    {
      teams = [media, marketing],
      roster = [member],
    }: { teams?: unknown[]; roster?: unknown[] } = {},
  ) {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method) return writes[`${init.method} ${input}`] ?? response({});
      if (input === "/api/teams") return response({ teams });
      return response({ members: roster });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** The Portfolio value on one member's card. */
  function portfolioOf(name: string) {
    const card = screen.getByRole("heading", { name }).closest<HTMLElement>("[data-slot=card]")!;
    return within(card).getByText("Portfolio").nextElementSibling;
  }

  it("renders the directory and confirms role changes", async () => {
    const fetchMock = stubApi({
      [`PATCH /api/members/${member.id}/role`]: response({
        member: { id: member.id, role: "director", tier: 1, createdAt: member.createdAt },
      }),
    });

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
    stubApi();

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

  it("names the teams a member is on", async () => {
    stubApi();

    render(<MembersPage />);

    const chips = await screen.findByRole("list", { name: "Teams for Alex Morgan" });
    expect(
      within(chips)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Media"]);
  });

  it("puts a member on a team from their card", async () => {
    const fetchMock = stubApi();

    render(<MembersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marketing" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/teams/${marketing.id}/members/${member.id}`, {
        method: "PUT",
        credentials: "include",
      }),
    );
    const chips = screen.getByRole("list", { name: "Teams for Alex Morgan" });
    await waitFor(() => expect(within(chips).getByText("Marketing")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Marketing" })).toBeChecked();
  });

  it("takes a member off a team from their card", async () => {
    const fetchMock = stubApi();

    render(<MembersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Media" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/teams/${media.id}/members/${member.id}`, {
        method: "DELETE",
        credentials: "include",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Teams for Alex Morgan" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("keeps the chips as they were and says so when a team change fails", async () => {
    stubApi({
      [`PUT /api/teams/${marketing.id}/members/${member.id}`]: {
        ok: false,
        status: 403,
        json: async () => ({}),
      },
    });

    render(<MembersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marketing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update Marketing");
    expect(screen.getByRole("checkbox", { name: "Marketing" })).not.toBeChecked();
  });

  it("offers a lead only the teams they lead", async () => {
    Object.assign(viewer, { role: "director", tier: 1 });
    stubApi();

    render(<MembersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));

    expect(screen.getByRole("checkbox", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Media" })).not.toBeInTheDocument();
  });

  describe("team leads", () => {
    it("makes a member a team's lead, which becomes their portfolio at once", async () => {
      const fetchMock = stubApi({
        [`PATCH /api/teams/${media.id}`]: response({ team: { ...media, lead: member.id } }),
      });

      render(<MembersPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));
      expect(portfolioOf("Alex Morgan")).toHaveTextContent("—");
      fireEvent.click(screen.getByRole("checkbox", { name: "Lead of Media" }));

      await waitFor(() => expect(portfolioOf("Alex Morgan")).toHaveTextContent("Media"));
      expect(fetchMock).toHaveBeenCalledWith(`/api/teams/${media.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead: member.id }),
      });
      expect(screen.getByRole("checkbox", { name: "Lead of Media" })).toBeChecked();
    });

    it("clears a member's lead of a team", async () => {
      const led = { ...media, lead: member.id };
      const fetchMock = stubApi(
        { [`PATCH /api/teams/${media.id}`]: response({ team: { ...media, lead: null } }) },
        { teams: [led, marketing] },
      );

      render(<MembersPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));
      expect(portfolioOf("Alex Morgan")).toHaveTextContent("Media");
      fireEvent.click(screen.getByRole("checkbox", { name: "Lead of Media" }));

      await waitFor(() => expect(portfolioOf("Alex Morgan")).toHaveTextContent("—"));
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/teams/${media.id}`,
        expect.objectContaining({ body: JSON.stringify({ lead: null }) }),
      );
    });

    it("names every team a member leads, not only the first", async () => {
      stubApi(
        {},
        {
          teams: [
            { ...media, lead: member.id },
            { ...marketing, lead: member.id },
          ],
        },
      );

      render(<MembersPage />);

      await waitFor(() => expect(portfolioOf("Alex Morgan")).toHaveTextContent("Media, Marketing"));
    });

    it("names each team's current lead, since a new lead replaces them", async () => {
      const president = {
        ...member,
        id: viewer.id,
        name: "Pat Rivera",
        email: "pat@example.com",
        role: "president",
        tier: 2,
      };
      stubApi({}, { roster: [member, president] });

      render(<MembersPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));

      const editor = screen.getByRole("dialog", { name: "Edit teams for Alex Morgan" });
      expect(within(editor).getByText("Lead: Pat Rivera")).toBeInTheDocument();
      expect(within(editor).getByText("No lead")).toBeInTheDocument();
    });

    it("offers a tier-1 lead no Lead boxes, as PATCH /api/teams/:id is tier 2", async () => {
      Object.assign(viewer, { role: "director", tier: 1 });
      stubApi();

      render(<MembersPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit teams for Alex Morgan" }));

      expect(screen.getByRole("checkbox", { name: "Marketing" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /lead of/i })).not.toBeInTheDocument();
    });
  });

  it("offers a tier-0 member no team editor", async () => {
    Object.assign(viewer, { role: "officer", tier: 0 });
    stubApi();

    render(<MembersPage />);

    await screen.findByRole("list", { name: "Teams for Alex Morgan" });
    expect(screen.queryByRole("button", { name: /edit teams/i })).not.toBeInTheDocument();
  });
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
