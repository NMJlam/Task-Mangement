import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("Tabs", () => {
  function renderTabs() {
    return render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>,
    );
  }

  /**
   * A tab sits 1px over the row's hairline (`-mb-px`). In a scroll container
   * that pixel overflowed, so the row grew a scroll area and cut each tab's
   * focus outline off at its edges. Every tab row in the app fits as it is.
   */
  it("draws the row without a scroll container", () => {
    renderTabs();

    expect(screen.getByRole("tablist").className).not.toMatch(/overflow/);
  });

  it("exposes tablist semantics the hand-rolled control could not, and moves on the arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderTabs();
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("First panel");

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Second panel");
  });
});
