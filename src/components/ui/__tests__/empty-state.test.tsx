// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders the title and icon, with no message or action by default", () => {
    const { container } = render(<EmptyState icon={Inbox} title="No notifications yet" />);
    expect(screen.getByText("No notifications yet")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the message when provided", () => {
    render(<EmptyState icon={Inbox} title="No notifications yet" message="You'll see updates here." />);
    expect(screen.getByText("You'll see updates here.")).toBeTruthy();
  });

  it("renders an anchor when action.href is provided", () => {
    render(<EmptyState icon={Inbox} title="No projects" action={{ label: "Create a project", href: "/projects/new" }} />);
    const link = screen.getByText("Create a project").closest("a");
    expect(link?.getAttribute("href")).toBe("/projects/new");
  });

  it("renders a button and calls onClick when action.onClick is provided", () => {
    const onClick = vi.fn();
    render(<EmptyState icon={Inbox} title="No filters" action={{ label: "New filter", onClick }} />);
    const button = screen.getByText("New filter").closest("button");
    expect(button).toBeTruthy();
    button?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies iconClassName to the icon, overriding the default muted color", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Something went wrong" iconClassName="text-danger" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("text-danger");
    expect(svg?.getAttribute("class")).not.toContain("text-muted-foreground");
  });
});
