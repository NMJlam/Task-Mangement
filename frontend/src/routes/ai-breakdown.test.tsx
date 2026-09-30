import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AiBreakdownPage } from "./ai-breakdown";

const threadId = "018f3a4b-0000-7000-8000-000000000001";
const runId = "018f3a4b-0000-7000-8000-000000000002";
const eventId = "018f3a4b-0000-7000-8000-000000000005";

afterEach(() => vi.unstubAllGlobals());

type Answer = { status: number; body: unknown };

/** Serves the page's reads, and answers the assistant with `assistant` when asked. */
function stubApi(assistant?: Answer | Promise<Answer>, history: unknown[] = [message()]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/threads") return Promise.resolve(response({ threads: [thread()] }));
    if (url === `/api/threads/${threadId}/messages`)
      return Promise.resolve(response({ messages: history, nextCursor: null }));
    if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task()] }));
    if (url === "/api/members") return Promise.resolve(response({ members: [] }));
    if (url === "/api/ai/messages" && assistant)
      return Promise.resolve(assistant).then((answer) => response(answer.body, answer.status));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(path = "/ai") {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AiBreakdownPage />
    </MemoryRouter>,
  );
  return userEvent.setup({ delay: null });
}

it("shows saved assistant output and generated tasks beside the composer", async () => {
  stubApi();
  renderPage();

  await waitFor(() => expect(screen.getByText("Film the opening keynote")).toBeInTheDocument());
  expect(screen.getByText(/I created 1 task for the media team/i)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeInTheDocument();
  expect(screen.queryByText("Planning is not connected yet")).not.toBeInTheDocument();
});

it("sends a message with the page's event seed and shows the plan it drafts", async () => {
  const fetchMock = stubApi({
    status: 200,
    body: {
      runId,
      reply: "Here is a plan.",
      proposal: {
        createTasks: [{ title: "Book the room", priority: "medium", dueAt: null, assignees: [] }],
      },
    },
  });
  const user = renderPage(`/ai?eventId=${eventId}`);
  await screen.findByRole("textbox", { name: "Message the assistant" });

  await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "Plan it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Here is a plan.")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Include Book the room" })).toBeChecked();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/ai/messages",
    expect.objectContaining({
      body: JSON.stringify({ text: "Plan it", seed: { eventId } }),
    }),
  );
});

it("shows the assistant thinking while a reply is on its way, then the reply", async () => {
  let answer!: (value: Answer) => void;
  stubApi(new Promise<Answer>((resolve) => (answer = resolve)));
  const user = renderPage();
  await screen.findByRole("textbox", { name: "Message the assistant" });

  await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "Plan it");
  await user.click(screen.getByRole("button", { name: "Send" }));

  // The member's own message is on screen at once, with the assistant visibly working.
  expect(await screen.findByText("Plan it")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "MAC Assistant is thinking" })).toBeInTheDocument();

  answer({ status: 200, body: { runId, reply: "All planned.", proposal: null } });

  expect(await screen.findByText("All planned.")).toBeInTheDocument();
  expect(
    screen.queryByRole("status", { name: "MAC Assistant is thinking" }),
  ).not.toBeInTheDocument();
});

it("keeps the composer and says the AI service is busy when the provider is", async () => {
  stubApi({
    status: 503,
    body: { error: { code: "AI_UNAVAILABLE", message: "The AI service is busy right now." } },
  });
  const user = renderPage();
  await screen.findByRole("textbox", { name: "Message the assistant" });

  await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The AI service is busy right now.");
  expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeInTheDocument();
  expect(screen.queryByText("The assistant is switched off")).not.toBeInTheDocument();
});

it("says the assistant is off on a 503, and keeps the history", async () => {
  stubApi({ status: 503, body: { error: { code: "AI_DISABLED", message: "Off." } } });
  const user = renderPage();
  await screen.findByRole("textbox", { name: "Message the assistant" });

  await user.type(screen.getByRole("textbox", { name: "Message the assistant" }), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("The assistant is switched off")).toBeInTheDocument();
  expect(screen.getByText(/I created 1 task for the media team/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Message the assistant" })).not.toBeInTheDocument();
});

it("reads a stored daily briefing as prose, not as its JSON", async () => {
  stubApi(undefined, [
    message({ body: JSON.stringify({ summary: "A quiet day.", bullets: ["Book the room"] }) }),
  ]);
  renderPage();

  expect(await screen.findByText("A quiet day.")).toBeInTheDocument();
  expect(screen.getByText("Book the room")).toBeInTheDocument();
  expect(screen.queryByText(/"summary"/u)).not.toBeInTheDocument();
});

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function thread() {
  return {
    id: threadId,
    kind: "ai",
    name: "assistant",
    teamId: null,
    eventId: null,
    minTier: 0,
    createdAt: "2026-09-16T00:00:00.000Z",
    memberIds: [],
    lastReadAt: null,
    unreadCount: 0,
    lastMessageAt: "2026-09-16T00:00:00.000Z",
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "018f3a4b-0000-7000-8000-000000000003",
    channelId: threadId,
    taskId: null,
    parentId: null,
    author: null,
    body: "I created 1 task for the media team: Film the opening keynote.",
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: runId,
    createdAt: "2026-09-16T00:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

function task() {
  return {
    id: "018f3a4b-0000-7000-8000-000000000004",
    eventId: null,
    teamId: null,
    assigneeIds: [],
    creator: null,
    title: "Film the opening keynote",
    description: null,
    status: "todo",
    priority: "high",
    dueAt: null,
    boardOrder: 0,
    minTier: 0,
    completedAt: null,
    aiRunId: runId,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}
