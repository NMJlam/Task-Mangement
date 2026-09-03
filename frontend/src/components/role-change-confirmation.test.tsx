import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoleChangeConfirmation } from "./role-change-confirmation";

it("shows capability gains and removals before confirmation", () => {
  const confirm = vi.fn();
  render(<RoleChangeConfirmation from="director" to="vice_president" onConfirm={confirm} />);

  expect(screen.getByText("member:role-change")).toBeInTheDocument();
  expect(screen.getByText("invite:create")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /confirm role change/i }));
  expect(confirm).toHaveBeenCalledOnce();
});
