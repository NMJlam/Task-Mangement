import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AiBreakdownPage } from "./ai-breakdown";

const CHAT_A = "018f3a4b-0000-7000-8000-0000000000a1";
const CHAT_B = "018f3a4b-0000-7000-8000-0000000000b2";
const NEW_CHAT = "018f3a4b-0000-7000-8000-0000000000c3";
const RUN_ID = "018f3a4b-0000-7000-8000-000000000002";
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000005";
const TASK_ID = "018f3a4b-0000-7000-8000-000000000006";

afterEach(() => vi.unstubAllGlobals());

type Answer = { status: number; body?: unknown };

const chat = (id: string, title: string, seedEventId: string | null = null) => ({
  id,
  title,
  seedEventId,
  lastMessageAt: "2026-10-01T02:00:00.000Z",
  createdAt: "2026-10-01T01:00:00.000Z",
});

let messageCount = 0;
const message = (role: "member" | "assistant", body: string, extra: object = {}) => ({
  id: `018f3a4b-0000-7000-8000-${String((messageCount += 1)).padStart(12, "0")}`,
  role,
  body,
  createdAt: "2026-10-01T01:00:00.000Z",
  runId: null,
  proposal: null,
  proposalStatus: null,
  applied: null,
  ...extra,
});

const plan = {
  createTasks: [{ title: "Book the room", priority: "medium", dueAt: null, assignees: [] }],
};

const busy: Answer = {
  status: 503,
  body: { error: { code: "AI_UNAVAILABLE", message: "The AI service is busy right now." } },
};
const off: Answer = { status: 503, body: { error: { code: "AI_DISABLED", message: "Off." } } };

/**
 * The page's whole API. `conversations` maps a chat id to what reading it
 * returns; a chat not listed there answers 404, as someone else's would.
 */
function stubApi(
  api: {
    chats?: ReturnType<typeof chat>[];
    conversations?: Record<string, ReturnType<typeof message>[]>;
    send?: Answer | Promise<Answer>;
    apply?: Answer;
    briefing?: Answer;
  } = {},
) {
  const chats = api.chats ?? [chat(CHAT_A, "Hack night plan"), chat(CHAT_B, "What is overdue?")];
  const respond = ({ status, body }: Answer) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const chatMatch = /^\/api\/ai\/chats\/([^/]+)(\/messages)?$/u.exec(url);

    if (url === "/api/members")
      return Promise.resolve(respond({ status: 200, body: { members: [] } }));
    if (url === "/api/ai/chats") return Promise.resolve(respond({ status: 200, body: { chats } }));
    if (url === "/api/ai/briefing") return Promise.resolve(respond(api.briefing ?? off));
    if (url === "/api/tasks") return Promise.resolve(respond({ status: 200, body: { tasks: [] } }));
    if (url.startsWith("/api/events")) {
      return Promise.resolve(respond({ status: 200, body: { items: [], nextCursor: null } }));
    }
    if (chatMatch && method === "GET") {
      const id = chatMatch[1]!;
      const messages = api.conversations?.[id];
      return Promise.resolve(
        respond(
          messages
            ? {
                status: 200,
                body: { chat: chats.find((item) => item.id === id) ?? chat(id, "Chat"), messages },
              }
            : {
                status: 404,
                body: { error: { code: "CHAT_NOT_FOUND", message: "Chat not found." } },
              },
        ),
      );
    }
    if (chatMatch && method === "PATCH") {
      const { title } = JSON.parse(String(init?.body)) as { title: string };
      return Promise.resolve(respond({ status: 200, body: { chat: chat(chatMatch[1]!, title) } }));
    }
    if (chatMatch && method === "DELETE") return Promise.resolve(respond({ status: 204 }));
    if (url === "/api/ai/messages" && api.send) return Promise.resolve(api.send).then(respond);
    if (url === "/api/ai/proposals/apply" && api.apply) return Promise.resolve(respond(api.apply));
    if (/^\/api\/ai\/proposals\/[^/]+\/discard$/u.test(url)) {
      return Promise.resolve(respond({ status: 204 }));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/ai", element: <AiBreakdownPage /> },
      { path: "/ai/briefing", element: <AiBreakdownPage view="briefing" /> },
      { path: "/ai/:chatId", element: <AiBreakdownPage /> },
    ],
    { initialEntries: [path], future: { v7_relativeSplatPath: true } },
  );
  render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
  return { router, user: userEvent.setup({ delay: null }) };
}

const composer = () => screen.getByRole("textbox", { name: "Message the assistant" });
const chatLink = (title: string) => screen.findByRole("link", { name: new RegExp(title, "u") });
const requests = (fetchMock: ReturnType<typeof stubApi>, method: string, url: string | RegExp) =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      (init?.method ?? "GET") === method &&
      (typeof url === "string" ? String(input) === url : url.test(String(input))),
  );

it("lists the member's chats beside a blank New chat", async () => {
  stubApi();
  renderAt("/ai");

  expect(await chatLink("Hack night plan")).toHaveAttribute("href", `/ai/${CHAT_A}`);
  expect(await chatLink("What is overdue")).toHaveAttribute("href", `/ai/${CHAT_B}`);
  expect(screen.getByRole("link", { name: "New chat" })).toHaveAttribute("href", "/ai");
  expect(composer()).toBeInTheDocument();
  // The old single-conversation page and its rail are gone.
  expect(screen.queryByRole("heading", { name: "Generated tasks" })).not.toBeInTheDocument();
});

it("opens a chat from the list and marks it as the open one", async () => {
  stubApi({
    conversations: {
      [CHAT_A]: [message("member", "Plan it"), message("assistant", "All planned.")],
    },
  });
  const { router, user } = renderAt("/ai");

  await user.click(await chatLink("Hack night plan"));

  expect(await screen.findByText("All planned.")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/ai/${CHAT_A}`);
  expect(await chatLink("Hack night plan")).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Hack night plan" })).toBeInTheDocument();
});

it("starts a chat with the first message and moves to it", async () => {
  let answer!: (value: Answer) => void;
  const fetchMock = stubApi({ send: new Promise<Answer>((resolve) => (answer = resolve)) });
  const { router, user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.type(composer(), "Plan a poker night");
  await user.click(screen.getByRole("button", { name: "Send" }));

  // The member's own message is on screen at once, with the assistant visibly working.
  expect(await screen.findByText("Plan a poker night")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "MAC Assistant is thinking" })).toBeInTheDocument();

  answer({
    status: 200,
    body: { chatId: NEW_CHAT, runId: RUN_ID, reply: "Here is a plan.", proposal: null },
  });

  expect(await screen.findByText("Here is a plan.")).toBeInTheDocument();
  expect(
    screen.queryByRole("status", { name: "MAC Assistant is thinking" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(router.state.location.pathname).toBe(`/ai/${NEW_CHAT}`));
  // The list is read again, so the new chat appears in it.
  await waitFor(() => expect(requests(fetchMock, "GET", "/api/ai/chats")).toHaveLength(2));
  // And the chat just created is not fetched back: it is already on screen.
  expect(requests(fetchMock, "GET", `/api/ai/chats/${NEW_CHAT}/messages`)).toHaveLength(0);
});

it("keeps a follow-up typed while the first reply is on its way", async () => {
  let answer!: (value: Answer) => void;
  stubApi({
    // The new chat is listed from the start, so the list can show when the
    // page has moved to it — the router's own state moves ahead of the render.
    chats: [chat(CHAT_A, "Hack night plan"), chat(NEW_CHAT, "Plan a poker night")],
    send: new Promise<Answer>((resolve) => (answer = resolve)),
  });
  const { router, user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.type(composer(), "Plan a poker night");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("status", { name: "MAC Assistant is thinking" });
  await user.type(composer(), "And a budget?");
  answer({
    status: 200,
    body: { chatId: NEW_CHAT, runId: RUN_ID, reply: "Here is a plan.", proposal: null },
  });

  // Saving the chat moves the address, but it is the same conversation.
  await waitFor(() => expect(router.state.location.pathname).toBe(`/ai/${NEW_CHAT}`));
  const created = screen.getByRole("link", { name: /Plan a poker night/u });
  await waitFor(() => expect(created).toHaveAttribute("aria-current", "page"));
  expect(screen.getByText("Here is a plan.")).toBeInTheDocument();
  expect(composer()).toHaveValue("And a budget?");
});

it("does not carry a half-typed message into another chat", async () => {
  stubApi({ conversations: { [CHAT_A]: [message("assistant", "All planned.")] } });
  const { user } = renderAt("/ai");

  await user.type(composer(), "Half a thought");
  await user.click(await chatLink("Hack night plan"));

  expect(await screen.findByText("All planned.")).toBeInTheDocument();
  expect(composer()).toHaveValue("");
});

it("carries the event from the address into a new chat", async () => {
  const fetchMock = stubApi({
    send: {
      status: 200,
      body: { chatId: NEW_CHAT, runId: RUN_ID, reply: "Done.", proposal: null },
    },
  });
  const { user } = renderAt(`/ai?eventId=${EVENT_ID}`);
  await chatLink("Hack night plan");

  await user.type(composer(), "Plan it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  await screen.findByText("Done.");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/ai/messages",
    expect.objectContaining({
      body: JSON.stringify({ text: "Plan it", seed: { eventId: EVENT_ID } }),
    }),
  );
});

it("puts the text back when the assistant is busy, and makes no chat", async () => {
  stubApi({ send: busy });
  const { router, user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.type(composer(), "Plan it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The AI service is busy right now.");
  expect(composer()).toHaveValue("Plan it");
  expect(router.state.location.pathname).toBe("/ai");
  expect(screen.queryByText("The assistant is switched off")).not.toBeInTheDocument();
});

it("replaces the composer with the switched-off notice, keeping the chats", async () => {
  stubApi({ send: off });
  const { user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.type(composer(), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("The assistant is switched off")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Message the assistant" })).not.toBeInTheDocument();
  expect(await chatLink("Hack night plan")).toBeInTheDocument();
});

it("renames a chat in place, and cancels on Escape without asking the server", async () => {
  const fetchMock = stubApi();
  const { user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.click(screen.getByRole("button", { name: "Rename Hack night plan" }));
  await user.clear(screen.getByRole("textbox", { name: "Chat title" }));
  await user.type(screen.getByRole("textbox", { name: "Chat title" }), "Poker night{Enter}");

  expect(await chatLink("Poker night")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/ai/chats/${CHAT_A}`,
    expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Poker night" }) }),
  );

  await user.click(screen.getByRole("button", { name: "Rename What is overdue?" }));
  await user.type(screen.getByRole("textbox", { name: "Chat title" }), " changed{Escape}");

  expect(await chatLink("What is overdue")).toBeInTheDocument();
  expect(requests(fetchMock, "PATCH", /\/api\/ai\/chats\//u)).toHaveLength(1);
});

it("hands focus back to Rename when a rename is saved or cancelled", async () => {
  stubApi();
  const { user } = renderAt("/ai");
  await chatLink("Hack night plan");

  await user.click(screen.getByRole("button", { name: "Rename Hack night plan" }));
  await user.keyboard("{Escape}");

  // The field goes away; a keyboard user is left where they were, not at the top of the page.
  expect(screen.getByRole("button", { name: "Rename Hack night plan" })).toHaveFocus();

  await user.keyboard("{Enter}");
  await user.keyboard("Poker night{Enter}");

  expect(await screen.findByRole("button", { name: "Rename Poker night" })).toHaveFocus();
});

it("deletes the open chat only after confirming, then returns to a blank chat", async () => {
  const fetchMock = stubApi({ conversations: { [CHAT_A]: [message("member", "Plan it")] } });
  const { router, user } = renderAt(`/ai/${CHAT_A}`);
  await screen.findByText("Plan it");

  await user.click(screen.getByRole("button", { name: "Delete Hack night plan" }));
  const dialog = await screen.findByRole("dialog");
  // Nothing is deleted by opening the dialog.
  expect(requests(fetchMock, "DELETE", /\/api\/ai\/chats\//u)).toHaveLength(0);
  await user.click(within(dialog).getByRole("button", { name: "Delete chat" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/ai"));
  expect(requests(fetchMock, "DELETE", `/api/ai/chats/${CHAT_A}`)).toHaveLength(1);
  expect(screen.queryByRole("link", { name: /Hack night plan/u })).not.toBeInTheDocument();
  expect(composer()).toBeInTheDocument();
});

it("shows a drafted plan as a live card under its reply, and applies it", async () => {
  const fetchMock = stubApi({
    conversations: {
      [CHAT_A]: [
        message("member", "Plan it"),
        message("assistant", "Here is a plan.", {
          runId: RUN_ID,
          proposal: plan,
          proposalStatus: "open",
        }),
      ],
    },
    apply: { status: 201, body: { events: [], tasks: [{ id: TASK_ID, title: "Book the room" }] } },
  });
  const { user } = renderAt(`/ai/${CHAT_A}`);

  expect(await screen.findByRole("checkbox", { name: "Include Book the room" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Create 1 task" }));

  await waitFor(() =>
    expect(requests(fetchMock, "POST", "/api/ai/proposals/apply")).toHaveLength(1),
  );
  const [, init] = requests(fetchMock, "POST", "/api/ai/proposals/apply")[0]!;
  expect(JSON.parse(String(init?.body))).toMatchObject({
    runId: RUN_ID,
    stats: { proposed: 1, kept: 1, edited: 0 },
  });
});

it("shows an applied plan as what it made, not a card", async () => {
  stubApi({
    conversations: {
      [CHAT_A]: [
        message("assistant", "Here is a plan.", {
          runId: RUN_ID,
          proposal: plan,
          proposalStatus: "applied",
          applied: {
            events: [{ id: EVENT_ID, title: "Hack Night" }],
            tasks: [
              { id: TASK_ID, title: "Book the room", eventId: EVENT_ID },
              { id: NEW_CHAT, title: "Tidy the cupboard", eventId: null },
            ],
          },
        }),
      ],
    },
  });
  renderAt(`/ai/${CHAT_A}`);

  expect(await screen.findByText("Applied")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Hack Night" })).toHaveAttribute(
    "href",
    `/events/${EVENT_ID}`,
  );
  expect(screen.getByRole("link", { name: "Book the room" })).toHaveAttribute(
    "href",
    `/events/${EVENT_ID}?tab=tasks`,
  );
  expect(screen.getByRole("link", { name: "Tidy the cupboard" })).toHaveAttribute("href", "/tasks");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("shows a discarded plan as discarded", async () => {
  stubApi({
    conversations: {
      [CHAT_A]: [
        message("assistant", "Here is a plan.", {
          runId: RUN_ID,
          proposal: plan,
          proposalStatus: "discarded",
        }),
      ],
    },
  });
  renderAt(`/ai/${CHAT_A}`);

  expect(await screen.findByText("Discarded")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("discards a plan from its card", async () => {
  const fetchMock = stubApi({
    conversations: {
      [CHAT_A]: [
        message("assistant", "Here is a plan.", {
          runId: RUN_ID,
          proposal: plan,
          proposalStatus: "open",
        }),
      ],
    },
  });
  const { user } = renderAt(`/ai/${CHAT_A}`);

  await user.click(await screen.findByRole("button", { name: "Discard" }));

  await waitFor(() =>
    expect(requests(fetchMock, "POST", `/api/ai/proposals/${RUN_ID}/discard`)).toHaveLength(1),
  );
});

it("says a chat no longer exists and offers a blank chat instead", async () => {
  stubApi();
  const { router } = renderAt(`/ai/${NEW_CHAT}`);

  expect(await screen.findByRole("alert")).toHaveTextContent("This chat no longer exists");
  await waitFor(() => expect(router.state.location.pathname).toBe("/ai"));
  expect(composer()).toBeInTheDocument();
});

it("links a chat to the event it is about", async () => {
  stubApi({
    chats: [chat(CHAT_A, "Hack night plan", EVENT_ID)],
    conversations: { [CHAT_A]: [message("member", "Plan it")] },
  });
  renderAt(`/ai/${CHAT_A}`);

  expect(await screen.findByRole("link", { name: "About this event" })).toHaveAttribute(
    "href",
    `/events/${EVENT_ID}`,
  );
});

it("keeps what the assistant has made behind a Generated toggle, closed until asked for", async () => {
  const fetchMock = stubApi();
  const { user } = renderAt("/ai");
  await chatLink("Hack night plan");
  const toggle = screen.getByRole("button", { name: "Generated" });

  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("complementary", { name: "Generated by the assistant" })).toBeNull();
  // Closed, it has asked for nothing.
  expect(requests(fetchMock, "GET", "/api/tasks")).toHaveLength(0);

  await user.click(toggle);

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    await screen.findByRole("complementary", { name: "Generated by the assistant" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Nothing generated yet.")).toBeInTheDocument();

  await user.click(toggle);

  expect(screen.queryByRole("complementary", { name: "Generated by the assistant" })).toBeNull();
});

const today: Answer = {
  status: 200,
  body: {
    briefing: { summary: "A quiet day.", bullets: ["Book the room"] },
    generatedAt: "2026-10-01T00:30:00.000Z",
  },
};

it("pins today's briefing above the chats", async () => {
  stubApi({ briefing: today });
  renderAt("/ai");

  const pinned = await screen.findByRole("link", { name: "Today's briefing" });
  expect(pinned).toHaveAttribute("href", "/ai/briefing");
  const firstChat = await chatLink("Hack night plan");
  // DOCUMENT_POSITION_FOLLOWING: the chats come after the pinned entry.
  expect(pinned.compareDocumentPosition(firstChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("hides the pinned briefing when the assistant is off", async () => {
  stubApi();
  renderAt("/ai");
  await chatLink("Hack night plan");

  expect(screen.queryByRole("link", { name: "Today's briefing" })).not.toBeInTheDocument();
});

it("shows the briefing, then starts a chat about it that opens with the briefing", async () => {
  const fetchMock = stubApi({
    briefing: today,
    send: {
      status: 200,
      body: { chatId: NEW_CHAT, runId: RUN_ID, reply: "Start with the room.", proposal: null },
    },
    conversations: {
      [NEW_CHAT]: [
        message("assistant", "A quiet day.\n- Book the room"),
        message("member", "What first?"),
        message("assistant", "Start with the room."),
      ],
    },
  });
  const { router, user } = renderAt("/ai/briefing");

  expect(await screen.findByText("A quiet day.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Today's briefing" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.type(screen.getByRole("textbox", { name: "Ask about this…" }), "What first?");
  await user.click(screen.getByRole("button", { name: "Ask" }));

  await waitFor(() => expect(router.state.location.pathname).toBe(`/ai/${NEW_CHAT}`));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/ai/messages",
    expect.objectContaining({
      body: JSON.stringify({ text: "What first?", seed: { briefing: true } }),
    }),
  );
  // The chat opens with the briefing — written on the server, so it is read back.
  expect(await screen.findByText("Start with the room.")).toBeInTheDocument();
  const log = screen.getByRole("log");
  expect(within(log).getAllByRole("article")[0]).toHaveTextContent("A quiet day.");
});

it("says when the briefing could not be prepared, and tries again", async () => {
  const fetchMock = stubApi({ briefing: busy });
  const { user } = renderAt("/ai/briefing");

  expect(await screen.findByText("Couldn't prepare today's briefing.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() => expect(requests(fetchMock, "GET", "/api/ai/briefing")).toHaveLength(2));
});
