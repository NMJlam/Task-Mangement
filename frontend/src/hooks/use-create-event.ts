import {
  apiErrorSchema,
  eventResponseSchema,
  type CreateEvent,
  type EventDetail,
} from "@ctp/shared";
import { useState } from "react";

export function useCreateEvent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function createEvent(input: CreateEvent): Promise<EventDetail | undefined> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        throw new Error(parsed.success ? parsed.data.error.message : "Failed to create event");
      }
      return eventResponseSchema.parse(body).event;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create event");
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, createEvent };
}
