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

it("still opens and switches theme when the browser blocks storage", () => {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);

  try {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /dark: comfortable at night/i }));

    // Not remembered, but shown for this visit.
    expect(document.documentElement).toHaveClass("dark");
  } finally {
    reads.mockRestore();
    writes.mockRestore();
  }
});
