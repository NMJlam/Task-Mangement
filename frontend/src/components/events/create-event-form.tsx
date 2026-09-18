import { CalendarPlus } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Inline create card, shaped like Add Task on the tasks page. Only the two fields
 * `createEventSchema` requires, plus venue — description, attendance and budget
 * allocation are a later `PATCH`, not a wall of inputs before the event exists.
 */
export function CreateEventForm({
  onSubmit,
  busy,
}: {
  onSubmit: (input: { title: string; startsAt: string; venue?: string }) => Promise<boolean>;
  busy: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const startsAt = String(data.get("startsAt") ?? "");
    const venue = String(data.get("venue") ?? "").trim();
    if (!title || !startsAt) return;
    void onSubmit({ title, startsAt, venue: venue || undefined }).then((created) => {
      if (created) form.reset();
    });
  }

  return (
    <Card className="mt-8 shadow-none">
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarPlus aria-hidden="true" className="size-5 text-muted-foreground" />
          New Event
        </h2>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-[1fr_14rem_1fr_auto]" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              name="title"
              autoComplete="off"
              placeholder="e.g. Annual General Meeting"
              maxLength={200}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-starts-at">Starts At</Label>
            <Input id="event-starts-at" name="startsAt" type="datetime-local" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-venue">Venue</Label>
            <Input
              id="event-venue"
              name="venue"
              autoComplete="off"
              placeholder="Optional"
              maxLength={200}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create Event"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
