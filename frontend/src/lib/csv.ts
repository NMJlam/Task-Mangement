import type { BudgetSummary } from "@ctp/shared";

/**
 * RFC 4180 field escaping. A field needs quoting the moment it carries the
 * delimiter, a quote, or a newline — an event title or category is free text
 * the club chose, so any of the three is possible, not hypothetical.
 * Internal quotes double, which is the only escape RFC 4180 defines.
 */
export function escapeCsvField(value: string | number): string {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsvRow(fields: readonly (string | number)[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** Cents to a plain decimal string — numeric and sortable in a spreadsheet, not a locale-formatted currency string like the page's own `money()`. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The budget page's own summary, laid out as three stacked tables rather than
 * one flat one: the overview row, the allocations, and the per-category
 * spend, don't share a column shape, and forcing them into one table would
 * mean padding every row with columns that mean nothing for it. A blank line
 * between sections is what most spreadsheet software treats as a natural
 * table break on import.
 */
export function budgetSummaryToCsv(summary: BudgetSummary): string {
  const lines: string[] = [];

  lines.push(toCsvRow(["Budget", "Allocated", "Committed", "Spent", "Available", "Risk"]));
  lines.push(
    toCsvRow([
      dollars(summary.budgetCents),
      dollars(summary.allocationCents),
      dollars(summary.committedCents),
      dollars(summary.spentCents),
      dollars(summary.availableCents),
      summary.risk,
    ]),
  );

  if (summary.allocations.length > 0) {
    lines.push("");
    lines.push(toCsvRow(["Event", "Allocated", "Committed", "Spent"]));
    for (const row of summary.allocations) {
      lines.push(
        toCsvRow([
          row.eventTitle,
          dollars(row.allocationCents),
          dollars(row.committedCents),
          dollars(row.spentCents),
        ]),
      );
    }
  }

  if (summary.byCategory.length > 0) {
    lines.push("");
    lines.push(toCsvRow(["Category", "Committed", "Spent"]));
    for (const row of summary.byCategory) {
      lines.push(toCsvRow([row.category, dollars(row.committedCents), dollars(row.spentCents)]));
    }
  }

  return lines.join("\n");
}

/**
 * Triggers a browser save-as for in-memory text — a Blob URL and a click on a
 * throwaway anchor, revoked immediately after, which is the standard way to
 * hand the browser a file that was never fetched from anywhere.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
