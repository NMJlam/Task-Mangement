import { RowShell } from "./row-shell";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import type { ResolvedCreateEvent, RowErrors } from "@/lib/ai-sections";

/** A proposed event: title, start, end and venue, each edited in place. */
export function CreateEventRow({
  rowKey,
  label,
  checked,
  onCheckedChange,
  value,
  onChange,
  errors,
  portalTarget = null,
}: {
  rowKey: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: ResolvedCreateEvent;
  onChange: (value: ResolvedCreateEvent) => void;
  errors: RowErrors;
  portalTarget?: HTMLElement | null;
}) {
  const venueId = `ai-${rowKey}-venue`;
  return (
    <RowShell
      rowKey={rowKey}
      label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      titleValue={value.title}
      onTitleChange={(title) => onChange({ ...value, title })}
      titleError={errors.title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DateTimePicker
          id={`ai-${rowKey}-starts`}
          label="start"
          timeLabel="Start time"
          value={value.startsAt}
          onChange={(startsAt) => startsAt && onChange({ ...value, startsAt })}
          allowClear={false}
          disabled={!checked}
          portalTarget={portalTarget}
        />
        <DateTimePicker
          id={`ai-${rowKey}-ends`}
          label="end"
          timeLabel="End time"
          value={value.endsAt ?? null}
          onChange={(endsAt) => onChange({ ...value, endsAt })}
          disabled={!checked}
          portalTarget={portalTarget}
        />
        <label htmlFor={venueId} className="sr-only">
          Venue
        </label>
        <Input
          id={venueId}
          placeholder="Venue"
          value={value.venue ?? ""}
          onChange={(event) => onChange({ ...value, venue: event.target.value || null })}
          disabled={!checked}
          className="w-40"
        />
      </div>
      {errors.endsAt ? <p className="text-sm text-destructive">{errors.endsAt}</p> : null}
    </RowShell>
  );
}
