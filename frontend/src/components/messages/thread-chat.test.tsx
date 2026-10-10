import type { Message, RosterMember } from "@ctp/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadChat } from "./thread-chat";
import { useThreadChat } from "@/hooks/use-thread-chat";

const A = "018f3a4b-0000-7000-8000-0000000000a1";
const B = "018f3a4b-0000-7000-8000-0000000000b2";
const SELF = "018f3a4b-0000-7000-8000-000000000001";
const OTHER = "018f3a4b-0000-7000-8000-000000000002";
const members: RosterMember[] = [
  {
    id: OTHER,
    role: "officer",
    tier: 0,
    createdAt: new Date("2026-01-01"),
    name: "Jamie",
    email: "jamie@example.com",
    teamIds: [],
    portfolio: null,
  },
];

function message(channelId: string, n = 1, author = SELF): Message {
  return {
    id: "018f3a4b-0000-7000-8000-" + String(n).padStart(12, "0"),
    channelId,
    author,
    body: "message " + n,
    taskId: null,
    parentId: null,
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: new Date(Date.UTC(2026, 9, 10, 12, n)),
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
  };
}
const response = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
function Harness({ id = A }: { id?: string }) {
  const chat = useThreadChat(id);
  return (
    <ThreadChat
      chat={chat}
      title={id === A ? "A" : "B"}
      kind="group"
      members={members}
      selfId={SELF}
      viewer={{ id: SELF, role: "officer" }}
    />
  );
}
afterEach(() => vi.unstubAllGlobals());

it("closes a message confirmation on a conversation change", async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    response({ messages: [message(url.includes(A) ? A : B)], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /^Delete message from/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<Harness id={B} />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(
    fetchMock.mock.calls.some(([, init]: [string, RequestInit?]) => init?.method === "DELETE"),
  ).toBe(false);
});

it("an old deletion cannot close a new conversation's confirmation", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((r) => {
    resolve = r;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return pending;
      return response({
        messages: [message(url.includes(A) ? A : B, url.includes(A) ? 1 : 2)],
        nextCursor: null,
      });
    }),
  );
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /^Delete message from/ }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete message" }),
  );
  view.rerender(<Harness id={B} />);
  await screen.findByText("message 2");
  fireEvent.click(screen.getByRole("button", { name: /^Delete message from/ }));
  await act(async () => {
    resolve(
      response({ message: { ...message(A), body: "", deletedAt: new Date(), deletedBy: SELF } }),
    );
  });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete message" }),
  ).toBeEnabled();
});

it("closes confirmation when the conversation becomes unavailable", async () => {
  let gone = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      gone
        ? response({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } }, 404)
        : response({ messages: [message(A)], nextCursor: null }),
    ),
  );
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /^Delete message from/ }));
  gone = true;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("textbox", { name: "Message A" })).not.toBeInTheDocument();
});

it("shows a continuation's timestamp even when its author cannot be deleted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({ messages: [message(A, 2, OTHER), message(A, 1, OTHER)], nextCursor: null }),
    ),
  );
  render(<Harness />);
  await screen.findByText("message 2");
  const row = screen.getByText("message 2").closest("article")!;
  expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  expect(row.querySelector("time")).not.toHaveClass("opacity-0");
});

it("dismisses a mention popup when a conversation changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ messages: [], nextCursor: null })),
  );
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole("textbox", { name: "Message A" }), {
    target: { value: "@Jam", selectionStart: 4 },
  });
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  view.rerender(<Harness id={B} />);
  await waitFor(() => expect(screen.queryByRole("log")).toBeInTheDocument());
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
