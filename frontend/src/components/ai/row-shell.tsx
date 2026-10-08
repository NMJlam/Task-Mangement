import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The frame every create row shares: a checkbox that decides whether the row
 * is applied, and a title edited in place. A `fieldset` so the row is one named
 * group to assistive tech, and so `disabled` greys every control inside it —
 * which is how a task whose staged event was unchecked drops out.
 *
 * A left-out row is marked by its background, never by opacity: fading the
 * whole row takes its muted text below AA contrast (2.4:1 measured by axe).
 *
 * The checkbox is native: it is a plain two-state control inside a form-like
 * list, with no styling Radix would add, and it keeps keyboard and label
 * behaviour for free.
 */
export function RowShell({
  rowKey,
  label,
  checked,
  onCheckedChange,
  disabled = false,
  titleValue,
  onTitleChange,
  titleError,
  children,
}: {
  rowKey: string;
  /** The row's name as proposed — stable while its title is being edited. */
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  titleValue: string;
  onTitleChange: (title: string) => void;
  titleError?: string;
  children?: ReactNode;
}) {
  const titleId = `ai-${rowKey}-title`;
  const errorId = `${titleId}-error`;
  return (
    <fieldset
      aria-label={label}
      disabled={disabled}
      className={cn("flex gap-3 px-4 py-3", (disabled || !checked) && "bg-foreground/5")}
    >
      <input
        type="checkbox"
        aria-label={`Include ${label}`}
        checked={checked && !disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-2.5 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <label htmlFor={titleId} className="sr-only">
          Title
        </label>
        <Input
          id={titleId}
          value={titleValue}
          onChange={(event) => onTitleChange(event.target.value)}
          disabled={disabled || !checked}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? errorId : undefined}
        />
        {titleError ? (
          <p id={errorId} className="text-sm text-destructive">
            {titleError}
          </p>
        ) : null}
        {children}
      </div>
    </fieldset>
  );
}
