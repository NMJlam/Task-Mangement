import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings";

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "member@example.com",
      role: "officer",
      tier: 0,
    },
  }),
}));

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

it("persists and applies the selected theme", () => {
  render(<SettingsPage />);

  fireEvent.click(screen.getByRole("button", { name: /dark: comfortable at night/i }));

  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
});
