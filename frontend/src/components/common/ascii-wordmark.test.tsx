import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AsciiWordmark } from "./ascii-wordmark";

it("draws MAC in ASCII, named MAC for assistive tech", () => {
  render(<AsciiWordmark />);

  const mark = screen.getByRole("img", { name: "MAC" });
  expect(mark.textContent).toContain(String.raw`|  \/  |`);
});
