// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityFeed } from "../ActivityFeed";

describe("ActivityFeed", () => {
  it("does not render raw HTML tags for a rich-text field change", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "1",
            action: "updated",
            field: "description",
            oldValue: "<p>Old text</p>",
            newValue: "<p>New text</p>",
            createdAt: new Date(),
            user: { id: "u1", name: "Alice" },
          },
        ]}
      />
    );

    expect(screen.queryByText(/<p>/)).toBeNull();
    expect(screen.getByText("Old text")).toBeTruthy();
    expect(screen.getByText("New text")).toBeTruthy();
  });

  it("still shows short plain-text field changes in full", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "2",
            action: "updated",
            field: "priority",
            oldValue: "MEDIUM",
            newValue: "HIGH",
            createdAt: new Date(),
            user: { id: "u1", name: "Alice" },
          },
        ]}
      />
    );

    expect(screen.getByText("MEDIUM")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
  });

  it("truncates a long rich-text field change instead of rendering it in full", () => {
    const longHtml = `<p>${"word ".repeat(40)}</p>`;
    render(
      <ActivityFeed
        entries={[
          {
            id: "3",
            action: "updated",
            field: "description",
            oldValue: null,
            newValue: longHtml,
            createdAt: new Date(),
            user: { id: "u1", name: "Alice" },
          },
        ]}
      />
    );

    const rendered = screen.getByText(/word/);
    expect(rendered.textContent?.length).toBeLessThan(longHtml.length);
    expect(rendered.textContent).toMatch(/…$/);
  });
});
