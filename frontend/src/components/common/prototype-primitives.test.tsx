import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";
import { UserAvatar } from "./user-avatar";

describe("prototype primitives", () => {
  it("renders page context and readable status labels", () => {
    render(
      <>
        <PageHeader title="Events" description="Plan club events" />
        <StatusBadge status="in_progress" />
        <UserAvatar name="Jordan Lee" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByText("Plan club events")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("JL")).toBeInTheDocument();
  });
});
