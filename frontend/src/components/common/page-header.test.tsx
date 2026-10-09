import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PageHeader } from "./page-header";
import { resetBindings, setBinding, setShortcutsEnabled } from "@/lib/shortcuts";

afterEach(() => {
  act(() => {
    setShortcutsEnabled(true);
    resetBindings();
  });
  localStorage.clear();
});

it("lists the page's keys under its subtitle, as bound, and only while shortcuts are on", () => {
  render(
    <PageHeader
      title="Tasks"
      description="Keep club work moving."
      hints={["move", "open", "new", "help"]}
    />,
  );

  const hints = screen.getByText("[w/a/s/d] move · [enter] open · [n] new · [?] all keys");
  expect(screen.getByText("Keep club work moving.").compareDocumentPosition(hints)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );

  act(() => void setBinding({ kind: "action", id: "new" }, "c"));
  expect(screen.getByText(/\[c\] new/u)).toBeInTheDocument();

  act(() => setShortcutsEnabled(false));
  expect(screen.queryByText(/all keys/u)).not.toBeInTheDocument();
});
