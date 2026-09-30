import { Input } from "@/components/ui/input";
import { EDITABLE_DIFF_FIELDS, type ResolvedUpdate, type RowErrors } from "@/lib/ai-sections";
import { cn } from "@/lib/utils";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  venue: "Venue",
  priority: "Priority",
  status: "Status",
  dueAt: "Due",
  startsAt: "Starts",
  endsAt: "Ends",
  assignees: "Assignees",
};

/** Dates read as the member's local date and time; everything else as written. */
function readable(field: string, value: string | null): string {
  if (value === null || value === "") return "—";
  if (field === "dueAt" || field === "startsAt" || field === "endsAt") {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  return value;
}

/**
 * A change to an existing row: one line per field as `before → after`. The
 * before is immutable text — it is what the row says now. The after is
 * editable where it is free text; a diff row cannot change which row it
 * targets, and leaving it out is what the checkbox is for.
 */
export function DiffRow({
  rowKey,
  checked,
  onCheckedChange,
  value,
  onChange,
  errors,
}: {
  rowKey: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: ResolvedUpdate;
  onChange: (value: ResolvedUpdate) => void;
  errors: RowErrors;
}) {
  const setAfter = (field: string, after: string) =>
    onChange({
      ...value,
      diffs: value.diffs.map((diff) => (diff.field === field ? { ...diff, after } : diff)),
    });

  return (
    <fieldset
      aria-label={value.title}
      className={cn("flex gap-3 px-4 py-3", !checked && "opacity-60")}
    >
      <input
        type="checkbox"
        aria-label={`Include ${value.title}`}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">{value.title}</p>
        <dl className="space-y-1.5 text-sm">
          {value.diffs.map((diff) => {
            const inputId = `ai-${rowKey}-${diff.field}`;
            const label = FIELD_LABELS[diff.field] ?? diff.field;
            return (
              <div key={diff.field} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="text-muted-foreground line-through decoration-1">
                    {readable(diff.field, diff.before)}
                  </span>
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">becomes</span>
                  {EDITABLE_DIFF_FIELDS.has(diff.field) ? (
                    <>
                      <label htmlFor={inputId} className="sr-only">
                        New {label.toLowerCase()}
                      </label>
                      <Input
                        id={inputId}
                        value={diff.after ?? ""}
                        onChange={(event) => setAfter(diff.field, event.target.value)}
                        disabled={!checked}
                        aria-invalid={errors[diff.field] ? true : undefined}
                        className="h-8 min-w-40 flex-1"
                      />
                    </>
                  ) : (
                    <span className="font-medium">{readable(diff.field, diff.after)}</span>
                  )}
                </dd>
                {errors[diff.field] ? (
                  <p className="w-full text-sm text-destructive">{errors[diff.field]}</p>
                ) : null}
              </div>
            );
          })}
        </dl>
      </div>
    </fieldset>
  );
}
