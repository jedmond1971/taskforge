import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// JFR-191: native <select>s on `bg-transparent` left their popup on the browser's white default
// in dark mode, with light inherited text — unreadable. One global rule themes every select's
// options; this guards it from being dropped in a stylesheet cleanup.
describe("globals.css native select options", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const rule = /select option[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("themes options with the popover surface", () => {
    expect(rule).toMatch(/background-color:\s*var\(--popover\)/);
    expect(rule).toMatch(/color:\s*var\(--popover-foreground\)/);
  });
});
