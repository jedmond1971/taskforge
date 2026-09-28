// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonoMeta } from "../mono-meta";

describe("MonoMeta", () => {
  it("renders its children with the monospace utility class", () => {
    render(<MonoMeta>JFR-151</MonoMeta>);
    const el = screen.getByText("JFR-151");
    expect(el.className).toContain("font-mono");
  });

  it("merges an additional className with the default classes", () => {
    render(<MonoMeta className="text-primary">JFR-151</MonoMeta>);
    const el = screen.getByText("JFR-151");
    expect(el.className).toContain("text-primary");
    expect(el.className).toContain("font-mono");
  });
});
