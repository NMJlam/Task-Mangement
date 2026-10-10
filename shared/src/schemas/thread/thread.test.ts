import { describe, expect, it } from "vitest";
import {
  createAttachmentSchema,
  createMessageSchema,
  createThreadSchema,
  listMessagesQuerySchema,
  MAX_ATTACHMENT_BYTES,
  messageResponseSchema,
  threadMessageParamsSchema,
  threadSchema,
} from "./thread.js";

const ID = "018f3a4b-0000-7000-8000-000000000001";

describe("createThreadSchema", () => {
  it("accepts a dm and a group, defaulting the group's members to none", () => {
    expect(createThreadSchema.parse({ kind: "dm", memberId: ID })).toEqual({
      kind: "dm",
      memberId: ID,
    });
    expect(createThreadSchema.parse({ kind: "group", name: "  Logistics " })).toEqual({
      kind: "group",
      name: "Logistics",
      memberIds: [],
    });
  });

  it("rejects the kinds that open with their parent or belong to the assistant", () => {
    for (const kind of ["team", "event", "ai"]) {
      expect(createThreadSchema.safeParse({ kind, name: "x" }).success).toBe(false);
    }
  });

  it("rejects a blank group name, matching channel_named_unless_dm_check", () => {
    expect(createThreadSchema.safeParse({ kind: "group", name: "   " }).success).toBe(false);
  });
});

describe("createMessageSchema", () => {
  it("trims the body and rejects a blank one, matching message_has_content_check", () => {
    expect(createMessageSchema.parse({ body: " hi " })).toEqual({ body: "hi" });
    expect(createMessageSchema.safeParse({ body: "  " }).success).toBe(false);
  });

  it("rejects a parentId that is not a uuid", () => {
    expect(createMessageSchema.safeParse({ body: "hi", parentId: "root" }).success).toBe(false);
  });
});

describe("listMessagesQuerySchema", () => {
  it("defaults the page size and coerces it from the query string", () => {
    expect(listMessagesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listMessagesQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("rejects an empty search and a non-uuid cursor", () => {
    expect(listMessagesQuerySchema.safeParse({ q: " " }).success).toBe(false);
    expect(listMessagesQuerySchema.safeParse({ before: "yesterday" }).success).toBe(false);
  });
});

describe("createAttachmentSchema", () => {
  const file = {
    fileKey: "tasks/abc/run-sheet.pdf",
    fileName: "run-sheet.pdf",
    fileSizeBytes: 2048,
    fileMime: "Application/PDF",
  };

  it("lowercases the MIME type and defaults the caption to empty", () => {
    expect(createAttachmentSchema.parse(file)).toEqual({
      ...file,
      fileMime: "application/pdf",
      body: "",
    });
  });

  it("rejects an empty or oversized file, and a malformed MIME type", () => {
    expect(createAttachmentSchema.safeParse({ ...file, fileSizeBytes: 0 }).success).toBe(false);
    expect(
      createAttachmentSchema.safeParse({ ...file, fileSizeBytes: MAX_ATTACHMENT_BYTES + 1 })
        .success,
    ).toBe(false);
    expect(createAttachmentSchema.safeParse({ ...file, fileMime: "pdf" }).success).toBe(false);
  });
});

describe("threadMessageParamsSchema", () => {
  it("takes the thread and the message, both as uuids", () => {
    expect(threadMessageParamsSchema.parse({ id: ID, messageId: ID })).toEqual({
      id: ID,
      messageId: ID,
    });
    expect(threadMessageParamsSchema.safeParse({ id: ID, messageId: "latest" }).success).toBe(
      false,
    );
    expect(threadMessageParamsSchema.safeParse({ id: ID }).success).toBe(false);
  });
});

describe("deletion fields", () => {
  const tombstone = {
    id: ID,
    channelId: ID,
    taskId: null,
    parentId: null,
    author: ID,
    body: "",
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: "2026-10-02T00:00:00.000Z",
    deletedBy: ID,
  };

  it("reads a tombstone, with its deletion time as a date", () => {
    const parsed = messageResponseSchema.parse({ message: tombstone });
    expect(parsed.message.deletedAt).toEqual(new Date("2026-10-02T00:00:00.000Z"));
    expect(parsed.message.body).toBe("");
  });

  it("requires the deletion fields, so a server from before the migration fails loudly", () => {
    const { deletedAt: _deletedAt, deletedBy: _deletedBy, ...old } = tombstone;
    expect(messageResponseSchema.safeParse({ message: old }).success).toBe(false);
  });

  it("requires a thread's creator, null allowed", () => {
    const thread = {
      id: ID,
      kind: "group",
      name: "Logistics",
      teamId: null,
      eventId: null,
      minTier: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
      memberIds: [ID],
      lastReadAt: null,
      unreadCount: 0,
      lastMessageAt: null,
    };
    expect(threadSchema.safeParse(thread).success).toBe(false);
    expect(threadSchema.parse({ ...thread, createdBy: null }).createdBy).toBeNull();
    expect(threadSchema.parse({ ...thread, createdBy: ID }).createdBy).toBe(ID);
  });
});
