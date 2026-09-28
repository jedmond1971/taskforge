// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "../page-header";

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
  });

  it("omits eyebrow, subtitle, and actions when not provided", () => {
    const { container } = render(<PageHeader title="Dashboard" />);
    expect(container.textContent).toBe("Dashboard");
  });

  it("renders eyebrow, subtitle, and actions when provided", () => {
    render(
      <PageHeader
        eyebrow="Tuesday, September 30"
        title="Welcome back, Jamie"
        subtitle="Here's what needs your attention today."
        actions={<button type="button">Create project</button>}
      />
    );
    expect(screen.getByText("Tuesday, September 30")).toBeTruthy();
    expect(screen.getByText("Here's what needs your attention today.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });
});
