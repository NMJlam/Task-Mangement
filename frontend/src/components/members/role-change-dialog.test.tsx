import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoleChangeDialog } from "./role-change-dialog";

it("shows capability gains and removals before confirmation", () => {
  const confirm = vi.fn();
  render(
    <RoleChangeDialog
      subject="Alex Morgan"
      from="director"
      to="vice_president"
      onConfirm={confirm}
      onClose={vi.fn()}
    />,
  );

  expect(
    screen.getByText(/change alex morgan from director to vice president/i),
  ).toBeInTheDocument();
  expect(screen.getByText("member:role-change")).toBeInTheDocument();
  expect(screen.getByText("invite:create")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /confirm role change/i }));
  expect(confirm).toHaveBeenCalledOnce();
});

it("closes through Cancel", () => {
  const close = vi.fn();
  render(
    <RoleChangeDialog
      subject="Alex Morgan"
      from="officer"
      to="director"
      onConfirm={vi.fn()}
      onClose={close}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

  expect(close).toHaveBeenCalledOnce();
});
