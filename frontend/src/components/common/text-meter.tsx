import { meterCells } from "@/lib/text-meter";
import { cn } from "@/lib/utils";

/**
 * A progress bar drawn the way a terminal draws one: `[██████░░░░]`.
 *
 * Two runs, each `cells` characters wide: a solid filled run and a tinted
 * track. Not a box per cell — at 125% and 150% display scaling a `1ch` box
 * lands on a fractional pixel and a row of them shows hairline seams — and not
 * `█`/`░` glyphs, which Windows draws from a taller fallback font that
 * overlapped the next row. Forced-colours handling is in index.css.
 *
 * Read-only, so `role="progressbar"` on a span is the right shape, as the `div`
 * bars it replaces were. The drawing is hidden; the name and `aria-valuetext`
 * carry the reading. The filled run is ink (or `--danger`), the track and
 * brackets `--muted-foreground` (docs/accessibility.md).
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
        {filled > 0 && (
          <span
            data-run="on"
            data-cells={filled}
            className={cn("meter-run", tone === "danger" ? "text-danger" : "text-foreground")}
            style={{ width: `${filled}ch` }}
          />
        )}
        {empty > 0 && (
          <span
            data-run="off"
            data-cells={empty}
            className="meter-run meter-run-off text-muted-foreground"
            style={{ width: `${empty}ch` }}
          />
        )}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ]
      </span>
    </span>
  );
}
