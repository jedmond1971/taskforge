// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import { sanitizeTipTapHtml, sanitizeDocxPreviewHtml } from "../sanitize-html";
import { XSS_PAYLOADS, activeContentIn } from "@/test-support/xss-payloads";

/**
 * SECH-106: the whole corpus through both sanitisers.
 *
 * This is the fast, hermetic half. The DB-backed half (stored-xss.itest.ts)
 * proves each *persistence path* actually calls one of these; this proves the
 * sanitisers themselves hold against every payload.
 */

describe("sanitizeTipTapHtml neutralises the stored-XSS corpus", () => {
  test.each(XSS_PAYLOADS.map((p) => [p.name, p] as const))("%s", (_name, p) => {
    const out = sanitizeTipTapHtml(p.payload);
    expect(activeContentIn(out), `${p.note}\npayload:   ${p.payload}\nsanitised: ${out}`).toEqual([]);
  });
});

describe("sanitizeDocxPreviewHtml neutralises the stored-XSS corpus", () => {
  // The DOCX allowlist is deliberately looser (tables, sup/sub, u) because real
  // Word documents use markup TipTap never produces. Looser must still mean inert.
  test.each(XSS_PAYLOADS.map((p) => [p.name, p] as const))("%s", (_name, p) => {
    const out = sanitizeDocxPreviewHtml(p.payload);
    expect(activeContentIn(out), `${p.note}\npayload:   ${p.payload}\nsanitised: ${out}`).toEqual([]);
  });
});

describe("the corpus checker itself", () => {
  // A detector that never fires would make every test above pass vacuously.
  test("flags raw payloads as active content", () => {
    const missed = XSS_PAYLOADS.filter((p) => activeContentIn(p.payload).length === 0).map((p) => p.name);

    // `encoded-script-stays-encoded` is intentionally inert as authored — it is
    // there to prove escaped text is preserved rather than decoded.
    expect(missed).toEqual(["encoded-script-stays-encoded"]);
  });

  test("does not flag ordinary rich text", () => {
    const benign =
      '<h2>Title</h2><p><strong>bold</strong> and <a href="https://example.com" rel="noopener noreferrer">a link</a></p>' +
      '<ul><li><p>item</p></li></ul><img src="/api/editor-images?key=editor-images/x.png" alt="">';

    expect(activeContentIn(benign)).toEqual([]);
  });
});

describe("legitimate content survives sanitisation", () => {
  test("escaped script text is preserved as text, not decoded into a tag", () => {
    const out = sanitizeTipTapHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");

    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script");
  });

  test("a normal external link keeps its href and rel", () => {
    const out = sanitizeTipTapHtml('<a href="https://example.com" rel="noopener noreferrer">x</a>');

    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("noopener");
  });

  test("an uploaded image keeps its src", () => {
    const out = sanitizeTipTapHtml('<img src="/api/editor-images?key=editor-images/x.png" alt="shot">');

    expect(out).toContain("/api/editor-images?key=editor-images/x.png");
  });
});
