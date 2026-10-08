import { meterCells } from "@/lib/text-meter";
import { cn } from "@/lib/utils";

/**
 * A progress bar drawn the way a terminal draws one: `[██████░░░░]`.
 *
 * Read-only, so `role="progressbar"` on a span is the right shape, as the `div`
 * bars it replaces were. The glyphs are decoration and hidden; the name and
 * `aria-valuetext` carry the reading. Filled cells are ink (or `--danger`), the
 * empty track is `--muted-foreground`: text tokens with measured contrast on
 * the page and on `--card` (docs/accessibility.md).
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
      className={cn("inline-flex font-mono leading-none whitespace-nowrap select-none", className)}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        [
      </span>
      <span aria-hidden="true" className={tone === "danger" ? "text-danger" : "text-foreground"}>
        {"█".repeat(filled)}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        {"░".repeat(empty)}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ]
      </span>
    </span>
  );
}
