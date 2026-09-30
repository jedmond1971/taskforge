// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiMarkdown } from "../AiMarkdown";

describe("AiMarkdown", () => {
  it("renders **bold** as <strong> with no literal asterisks", () => {
    const { container } = render(<AiMarkdown content="Loaded **JFR-142** for you" />);
    expect(container.querySelector("strong")?.textContent).toBe("JFR-142");
    expect(container.textContent).not.toContain("*");
  });

  it("renders numbered and bulleted lists as real lists", () => {
    const { container } = render(<AiMarkdown content={"1. one\n2. two\n\n- a\n- b"} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("renders inline code and fenced blocks", () => {
    const { container } = render(<AiMarkdown content={"Use `create_issue`.\n\n```\nconst x = 1;\n```"} />);
    expect(screen.getByText("create_issue").tagName).toBe("CODE");
    expect(container.querySelector("pre")?.textContent).toContain("const x = 1;");
  });

  it("renders GFM tables", () => {
    const { container } = render(<AiMarkdown content={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("does not render raw HTML from the source", () => {
    const { container } = render(
      <AiMarkdown content={'<img src=x onerror="alert(1)"><script>alert(1)</script> hi'} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("strips javascript: URLs and opens safe links in a new tab safely", () => {
    const { container } = render(
      <AiMarkdown content={"[bad](javascript:alert(1)) and [ok](https://example.com)"} />
    );
    const links = Array.from(container.querySelectorAll("a"));
    const bad = links.find((a) => a.textContent === "bad");
    expect(bad?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    const ok = links.find((a) => a.textContent === "ok");
    expect(ok?.getAttribute("href")).toBe("https://example.com");
    expect(ok?.getAttribute("target")).toBe("_blank");
    expect(ok?.getAttribute("rel")).toContain("noopener");
  });
});
