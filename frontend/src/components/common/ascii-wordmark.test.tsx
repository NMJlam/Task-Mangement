import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AsciiWordmark } from "./ascii-wordmark";

it("draws MAC in ASCII, named MAC for assistive tech", () => {
  // Callers size it; a size class must not take the tight leading with it, or
  // the art's rows drift apart.
  render(<AsciiWordmark className="text-sm" />);

  const mark = screen.getByRole("img", { name: "MAC" });
  expect(mark.textContent).toContain(String.raw`|  \/  |`);
  expect(mark).toHaveClass("text-sm", "leading-[1.05]");
});
