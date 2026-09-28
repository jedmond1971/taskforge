// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocWorkbar } from "../doc-workbar";

describe("DocWorkbar", () => {
  it("renders the back link and title", () => {
    render(<DocWorkbar backHref="/projects/pl/docs" backLabel="Docs" title="API authentication guide" />);
    const link = screen.getByText("Docs").closest("a");
    expect(link?.getAttribute("href")).toBe("/projects/pl/docs");
    expect(screen.getByText("API authentication guide")).toBeTruthy();
  });

  it("renders actions when provided, and omits the actions container when not", () => {
    const { rerender, container } = render(
      <DocWorkbar backHref="/projects/pl/docs" backLabel="Docs" title="Untitled" />
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);

    rerender(
      <DocWorkbar
        backHref="/projects/pl/docs"
        backLabel="Docs"
        title="Untitled"
        actions={<button type="button">Edit</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});
