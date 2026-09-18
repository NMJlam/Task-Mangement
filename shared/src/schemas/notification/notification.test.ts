import { describe, expect, it } from "vitest";
import {
  listNotificationsQuerySchema,
  notificationKindSchema,
  notificationSchema,
} from "./notification.js";

describe("notification schemas", () => {
  it("accepts known kinds", () => {
    expect(notificationKindSchema.safeParse("mention").success).toBe(true);
    expect(notificationKindSchema.safeParse("expense_submitted").success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(notificationKindSchema.safeParse("task_deleted").success).toBe(false);
  });
});

describe("notificationSchema", () => {
  const base = {
    id: "0198e1a0-0000-7000-8000-000000000001",
    userId: "0198e1a0-0000-7000-8000-000000000002",
    kind: "mention",
    body: "Someone mentioned you.",
    entityType: null,
    entityId: null,
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  it("accepts a row with no deep-link target", () => {
    expect(notificationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a row with a deep-link target", () => {
    expect(
      notificationSchema.safeParse({
        ...base,
        entityType: "event",
        entityId: "0198e1a0-0000-7000-8000-000000000003",
        readAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed id", () => {
    expect(notificationSchema.safeParse({ ...base, id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("listNotificationsQuerySchema", () => {
  it("defaults limit, offset and unreadOnly", () => {
    expect(listNotificationsQuerySchema.parse({})).toMatchObject({
      unreadOnly: false,
      limit: 50,
      offset: 0,
    });
  });

  it("coerces query-string values", () => {
    expect(
      listNotificationsQuerySchema.parse({ unreadOnly: "true", limit: "10", offset: "20" }),
    ).toMatchObject({ unreadOnly: true, limit: 10, offset: 20 });
  });

  it("parses unreadOnly=false as false", () => {
    expect(listNotificationsQuerySchema.parse({ unreadOnly: "false" }).unreadOnly).toBe(false);
    expect(listNotificationsQuerySchema.parse({ unreadOnly: "0" }).unreadOnly).toBe(false);
  });

  it("rejects a non-boolean unreadOnly", () => {
    expect(listNotificationsQuerySchema.safeParse({ unreadOnly: "maybe" }).success).toBe(false);
  });

  it("rejects a limit above the cap", () => {
    expect(listNotificationsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});
