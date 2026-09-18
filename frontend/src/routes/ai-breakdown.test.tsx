import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiBreakdownPage } from "./ai-breakdown";

const threadId = "018f3a4b-0000-7000-8000-000000000001";
const runId = "018f3a4b-0000-7000-8000-000000000002";

afterEach(() => vi.unstubAllGlobals());

it("shows saved assistant output and generated tasks without fake controls", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/threads") return Promise.resolve(response({ threads: [thread()] }));
    if (url === `/api/threads/${threadId}/messages`)
      return Promise.resolve(response({ messages: [message()], nextCursor: null }));
    if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task()] }));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AiBreakdownPage />);

  await waitFor(() => expect(screen.getByText("Film the opening keynote")).toBeInTheDocument());
  expect(screen.getByText(/I created 1 task for the media team/i)).toBeInTheDocument();
  expect(screen.getByText("Planning is not connected yet")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
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

function message() {
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
  };
}

function task() {
  return {
    id: "018f3a4b-0000-7000-8000-000000000004",
    eventId: null,
    teamId: null,
    assignee: null,
    creator: null,
    title: "Film the opening keynote",
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
