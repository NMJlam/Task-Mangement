import { describe, expect, it } from "vitest";
import { budgetSummaryToCsv, escapeCsvField, toCsvRow } from "./csv";

describe("escapeCsvField", () => {
  it("leaves a plain field alone", () => {
    expect(escapeCsvField("Printing")).toBe("Printing");
    expect(escapeCsvField(12.5)).toBe("12.5");
  });

  it("quotes a field containing a comma", () => {
    expect(escapeCsvField("Venue, deposit")).toBe('"Venue, deposit"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(escapeCsvField('The "big" event')).toBe('"The ""big"" event"');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvField("Line one\nLine two")).toBe('"Line one\nLine two"');
  });
});

describe("toCsvRow", () => {
  it("joins fields with commas, escaping as needed", () => {
    expect(toCsvRow(["a", "b, c", 3])).toBe('a,"b, c",3');
  });
});

describe("budgetSummaryToCsv", () => {
  const summary = {
    budgetCents: 10_000,
    allocationCents: 5_000,
    committedCents: 1_250,
    spentCents: 750,
    availableCents: 5_000,
    risk: "at_risk" as const,
    allocations: [
      {
        eventId: "018f3a4b-0000-7000-8000-000000000009",
        eventTitle: "Semester Hackathon",
        allocationCents: 2_500,
        committedCents: 3_000,
        spentCents: 1_000,
      },
    ],
    byCategory: [{ category: "catering" as const, committedCents: 1_250, spentCents: 750 }],
  };

  it("writes the overview row in dollars, not cents", () => {
    const csv = budgetSummaryToCsv(summary);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Budget,Allocated,Committed,Spent,Available,Risk");
    expect(lines[1]).toBe("100.00,50.00,12.50,7.50,50.00,at_risk");
  });

  it("includes an allocation-by-event section", () => {
    expect(budgetSummaryToCsv(summary)).toContain(
      "Event,Allocated,Committed,Spent\nSemester Hackathon,25.00,30.00,10.00",
    );
  });

  it("includes a spend-by-category section", () => {
    expect(budgetSummaryToCsv(summary)).toContain("Category,Committed,Spent\ncatering,12.50,7.50");
  });

  it("omits a section entirely when its list is empty", () => {
    const csv = budgetSummaryToCsv({ ...summary, allocations: [], byCategory: [] });
    expect(csv).not.toContain("Event,Allocated");
    expect(csv).not.toContain("Category,Committed");
  });

  it("quotes an event title that contains a comma", () => {
    const csv = budgetSummaryToCsv({
      ...summary,
      allocations: [{ ...summary.allocations[0]!, eventTitle: "Gala, 2026" }],
    });
    expect(csv).toContain('"Gala, 2026"');
  });
});
