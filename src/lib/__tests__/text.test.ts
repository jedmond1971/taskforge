import { describe, it, expect } from "vitest";
import { stripHtml, truncateText } from "../text";

describe("stripHtml", () => {
  it("removes tags and collapses whitespace left behind", () => {
    expect(stripHtml("<p>New text</p>")).toBe("New text");
  });

  it("collapses multiple tags and nested markup into single spaces", () => {
    expect(stripHtml("<p>Hello <strong>world</strong></p><p>Again</p>")).toBe("Hello world Again");
  });

  it("returns plain text unchanged", () => {
    expect(stripHtml("Medium")).toBe("Medium");
  });
});

describe("truncateText", () => {
  it("returns text unchanged when at or under the limit", () => {
    expect(truncateText("Medium", 60)).toBe("Medium");
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    const long = "a".repeat(80);
    const result = truncateText(long, 60);
    expect(result).toBe(`${"a".repeat(60)}…`);
    expect(result.length).toBe(61);
  });
});
