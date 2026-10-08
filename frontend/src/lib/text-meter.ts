/**
 * How many of a meter's `cells` a value fills. Whole cells only: the exact
 * figure is always printed beside the bar, so the bar's job is the shape.
 *
 * Two rules keep the shape honest at the ends. Any non-zero value fills at
 * least one cell, so "1 open task" never draws as none. Anything short of max
 * leaves at least one cell empty, so 99% never draws as done. At or over max is
 * a full bar; the caller says "over" in words and colour.
 */
export function meterCells(
  value: number,
  max: number,
  cells: number,
): { filled: number; empty: number } {
  if (max <= 0 || value <= 0) return { filled: 0, empty: cells };
  if (value >= max) return { filled: cells, empty: 0 };
  const filled = Math.min(cells - 1, Math.max(1, Math.round((value / max) * cells)));
  return { filled, empty: cells - filled };
}
