// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { StrictMode, useCallback, useRef, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { RichTextDisplay, type TocHeading } from "../rich-text-display";

// Regression coverage for docs-invariants.md rule 13: RichTextDisplay's id-assignment
// effect must stay dependency-array-free (see the comment on that effect). TocHost below
// mirrors the real production usage (doc-page-editor.tsx passes a `useState` setter as
// `onHeadingsExtracted`), which is what triggers the dev-mode double-render clobber. The
// callback identity must stay stable across renders (like a raw `setState` setter would
// be) — an inline arrow function here would mask a reintroduced `[content,
// onHeadingsExtracted]` dependency array, since its identity would already change on
// every render regardless of the effect's own bug.
function TocHost({
  content,
  onExtract,
}: {
  content: string;
  onExtract?: (headings: TocHeading[]) => void;
}) {
  const [toc, setToc] = useState<TocHeading[]>([]);
  const onExtractRef = useRef(onExtract);
  onExtractRef.current = onExtract;
  const handleHeadingsExtracted = useCallback((headings: TocHeading[]) => {
    onExtractRef.current?.(headings);
    setToc(headings);
  }, []);
  return (
    <div>
      <ul>
        {toc.map((h) => (
          <li key={h.id} data-testid="toc-item">
            {h.id}
          </li>
        ))}
      </ul>
      <RichTextDisplay content={content} onHeadingsExtracted={handleHeadingsExtracted} />
    </div>
  );
}

describe("RichTextDisplay TOC heading ids (docs-invariants.md rule 13)", () => {
  it("assigns stable h2 ids through React StrictMode's dev-mode double render", () => {
    const html = "<h2>Getting Started</h2><p>intro</p><h2>Advanced Usage</h2>";
    const { container } = render(
      <StrictMode>
        <TocHost content={html} />
      </StrictMode>
    );

    const headings = container.querySelectorAll("h2");
    expect(headings).toHaveLength(2);
    expect(headings[0].id).toBe("getting-started");
    expect(headings[1].id).toBe("advanced-usage");

    const items = screen.getAllByTestId("toc-item");
    expect(items.map((el) => el.textContent)).toEqual(["getting-started", "advanced-usage"]);
  });

  it("self-heals when the container's innerHTML is externally reset after mount", () => {
    const html = "<h2>Section One</h2>";
    const { container, rerender } = render(<TocHost content={html} />);

    const div = container.querySelector(".rich-prose") as HTMLDivElement;
    expect(div.querySelector("h2")!.id).toBe("section-one");

    // Simulate the historical clobber: the same DOM node's markup gets reset to its
    // id-less form without React's knowledge (sameNode === true, not a remount).
    act(() => {
      div.innerHTML = html;
    });
    expect(div.querySelector("h2")!.id).toBe("");

    // Force another commit without changing `content`. If the effect were gated on
    // [content, onHeadingsExtracted] (the historical bug), it would NOT rerun here and
    // the id would stay wiped.
    rerender(<TocHost content={html} />);

    expect(div.querySelector("h2")!.id).toBe("section-one");
  });

  it("does not re-notify the parent once the computed TOC signature stops changing", () => {
    const html = "<h2>Alpha</h2><h2>Beta</h2>";
    const onExtract = vi.fn();
    const { rerender } = render(<TocHost content={html} onExtract={onExtract} />);
    expect(onExtract).toHaveBeenCalledTimes(1);

    rerender(<TocHost content={html} onExtract={onExtract} />);
    rerender(<TocHost content={html} onExtract={onExtract} />);

    // The effect reruns on every commit by design, but the signature guard must keep it
    // from calling back up to the parent (and thus looping renders) when nothing changed.
    expect(onExtract).toHaveBeenCalledTimes(1);
  });
});
