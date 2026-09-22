"use client";

/**
 * Read-only renderer for rich text HTML stored in the database.
 * Handles plain-text fallback gracefully.
 */

import { useEffect, useRef } from "react";
import { slugify } from "@/lib/slugify";

export interface TocHeading {
  id: string;
  text: string;
}

interface RichTextDisplayProps {
  content: string;
  className?: string;
  onHeadingsExtracted?: (headings: TocHeading[]) => void;
}

// NOTE: This function does NOT sanitize HTML. Sanitization is performed server-side
// in src/lib/sanitize-html.ts before content is persisted. This function only handles
// the plain-text → HTML conversion for legacy content that predates TipTap.
function normalizeRichTextContent(content: string): string {
  // If content doesn't look like HTML, treat it as plain text
  if (!content.includes("<")) {
    return content
      .split("\n\n")
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  return content;
}

export function RichTextDisplay({ content, className = "", onHeadingsExtracted }: RichTextDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSignatureRef = useRef<string>("");

  // Stored HTML doesn't carry heading ids (the sanitizer's attribute allowlist doesn't
  // include `id`), so TOC anchors are derived here, client-side, after paint. Runs after
  // every commit (no dependency array) rather than being gated on `content`, because a
  // dev-mode-only React quirk can reset this dangerouslySetInnerHTML node's markup right
  // after the first extraction's setState — re-running unconditionally makes id assignment
  // self-healing. The signature guard below prevents that from looping renders forever.
  // Keep this effect dependency-array-free — see docs-invariants.md rule 13 for the full
  // history, and __tests__/rich-text-display.test.tsx for the regression test.
  useEffect(() => {
    if (!onHeadingsExtracted) return;
    const headings = Array.from(containerRef.current?.querySelectorAll("h2") ?? []);
    const seen = new Map<string, number>();
    const toc = headings.map((el) => {
      const base = slugify(el.textContent ?? "") || "section";
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const id = n > 0 ? `${base}-${n + 1}` : base;
      el.id = id;
      return { id, text: el.textContent ?? "" };
    });
    const signature = toc.map((h) => h.id).join("|");
    if (signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      onHeadingsExtracted(toc);
    }
  });

  return (
    <div
      ref={containerRef}
      className={`rich-prose text-sm text-zinc-700 dark:text-zinc-300 ${className}`}
      dangerouslySetInnerHTML={{ __html: normalizeRichTextContent(content) }}
    />
  );
}
