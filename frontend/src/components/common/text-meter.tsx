import { meterCells } from "@/lib/text-meter";
import { cn } from "@/lib/utils";

/**
 * A progress bar drawn the way a terminal draws one: `[██████░░░░]`.
 *
 * The cells are character-wide boxes (`.meter-cell` in index.css), not `█`/`░`
 * characters: Windows draws `░` from a fallback font that is taller than the
 * monospace stack, so a glyph track sat high and overlapped the next row. A
 * filled cell is solid; the empty track is a dither, the way `░` looks.
 *
 * Read-only, so `role="progressbar"` on a span is the right shape, as the `div`
 * bars it replaces were. The drawing is hidden; the name and `aria-valuetext`
 * carry the reading. Filled cells are ink (or `--danger`), the track and
 * brackets `--muted-foreground`: text tokens with measured contrast on the page
 * and on `--card` (docs/accessibility.md).
 */
export function TextMeter({
  value,
  max,
  label,
  valueText,
  cells = 10,
  tone = "default",
  className,
}: {
  value: number;
  max: number;
  label: string;
  valueText: string;
  cells?: number;
  tone?: "default" | "danger";
  className?: string;
}) {
  const { filled, empty } = meterCells(value, max, cells);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(value, max)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={valueText}
      data-slot="text-meter"
      className={cn(
        "inline-flex items-center font-mono leading-none whitespace-nowrap select-none",
        className,
      )}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        [
      </span>
      <span aria-hidden="true" className="inline-flex">
        {Array.from({ length: filled }, (_, index) => (
          <span
            key={`on-${index}`}
            data-cell="on"
            className={cn("meter-cell", tone === "danger" ? "text-danger" : "text-foreground")}
          />
        ))}
        {Array.from({ length: empty }, (_, index) => (
          <span
            key={`off-${index}`}
            data-cell="off"
            className="meter-cell meter-cell-off text-muted-foreground"
          />
        ))}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ]
      </span>
    </span>
  );
}
