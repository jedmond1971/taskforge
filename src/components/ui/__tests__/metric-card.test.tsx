// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Folder } from "lucide-react";
import { MetricCard } from "../metric-card";

describe("MetricCard", () => {
  it("renders the label and value", () => {
    render(<MetricCard label="Active projects" value={4} />);
    expect(screen.getByText("Active projects")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders the icon when provided", () => {
    const { container } = render(<MetricCard label="Active projects" value={4} icon={Folder} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders trend label only when trend is provided", () => {
    const { rerender } = render(<MetricCard label="Assigned to you" value={7} />);
    expect(screen.queryByText(/since last week/)).toBeNull();

    rerender(
      <MetricCard
        label="Assigned to you"
        value={7}
        trend={{ direction: "up", label: "+2 since last week" }}
      />
    );
    expect(screen.getByText("+2 since last week")).toBeTruthy();
  });
});
