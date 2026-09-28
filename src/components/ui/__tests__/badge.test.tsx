// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip, MetaChip } from "../badge";

describe("StatusChip", () => {
  it("renders the given label for each status category", () => {
    const { rerender } = render(<StatusChip category="TODO" label="Backlog" />);
    expect(screen.getByText("Backlog")).toBeTruthy();

    rerender(<StatusChip category="IN_PROGRESS" label="In Progress" />);
    expect(screen.getByText("In Progress")).toBeTruthy();

    rerender(<StatusChip category="DONE" label="Done" />);
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("applies a different class per category so they are visually distinct", () => {
    const { container: todoContainer } = render(<StatusChip category="TODO" label="Backlog" />);
    const { container: doneContainer } = render(<StatusChip category="DONE" label="Done" />);
    const todoClass = todoContainer.querySelector("span")?.className;
    const doneClass = doneContainer.querySelector("span")?.className;
    expect(todoClass).not.toBe(doneClass);
  });
});

describe("MetaChip", () => {
  it("renders the given label for each priority, never relying on color alone", () => {
    render(<MetaChip priority="CRITICAL" label="Critical" />);
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  it("applies a different class per priority so they are visually distinct", () => {
    const { container: criticalContainer } = render(<MetaChip priority="CRITICAL" label="Critical" />);
    const { container: lowContainer } = render(<MetaChip priority="LOW" label="Low" />);
    const criticalClass = criticalContainer.querySelector("span")?.className;
    const lowClass = lowContainer.querySelector("span")?.className;
    expect(criticalClass).not.toBe(lowClass);
  });
});
