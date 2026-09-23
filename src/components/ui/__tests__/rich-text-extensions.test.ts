// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";

import { buildEditorExtensions } from "../rich-text-extensions";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

// SECH-124 (TipTap v2 -> v3): the editor's own extension set, driven headlessly.
//
// Two things have to stay true across a TipTap upgrade, and neither is visible to
// a type check or a build:
//   1. HTML authored by the previous version still loads without losing content.
//   2. getHTML() only emits tags and attributes that sanitizeTipTapHtml() keeps —
//      anything else is silently dropped on save, so the user loses work.
//
// The extension set is imported from the same module the editor component uses,
// so this cannot drift from the real configuration.

function makeEditor(content: string) {
  return new Editor({
    extensions: buildEditorExtensions("Write something..."),
    content,
  });
}

/** Round-trip content through the editor exactly as the component does on save. */
function roundTrip(content: string) {
  const editor = makeEditor(content);
  const html = editor.isEmpty ? "" : editor.getHTML();
  editor.destroy();
  return html;
}

// Representative of what the v2 editor actually stored: every toolbar feature.
const V2_STORED_HTML = [
  "<h2>Heading two</h2>",
  "<h3>Heading three</h3>",
  "<p><strong>bold</strong> <em>italic</em> <s>strike</s> <code>inline code</code></p>",
  "<ul><li><p>bullet one</p></li><li><p>bullet two</p></li></ul>",
  "<ol><li><p>first</p></li><li><p>second</p></li></ol>",
  "<blockquote><p>a quotation</p></blockquote>",
  "<pre><code>const x = 1;</code></pre>",
  "<hr>",
  '<p><a target="_blank" rel="noopener noreferrer" href="https://example.com">a link</a></p>',
  '<img src="/api/editor-images?key=editor-images/screenshot.png" alt="">',
].join("");

describe("editor extension set", () => {
  test("normalises an empty document to the empty string, not <p></p>", () => {
    // rich-text.md: empty state is stored as "" so `|| null` checks keep working.
    expect(roundTrip("")).toBe("");
    expect(roundTrip("<p></p>")).toBe("");
  });

  test("preserves every formatting mark authored by the previous version", () => {
    const html = roundTrip(V2_STORED_HTML);

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain("<code>inline code</code>");
  });

  test("preserves block structure authored by the previous version", () => {
    const html = roundTrip(V2_STORED_HTML);

    expect(html).toContain("<h2>Heading two</h2>");
    expect(html).toContain("<h3>Heading three</h3>");
    expect(html).toContain("bullet one");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("const x = 1;");
    expect(html).toContain("<hr>");
  });

  test("keeps the rel hardening on links", () => {
    // The whole reason Link is configured rather than left at its defaults.
    const html = roundTrip(V2_STORED_HTML);

    expect(html).toContain('href="https://example.com"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  test("keeps uploaded image sources intact", () => {
    const html = roundTrip(V2_STORED_HTML);

    expect(html).toContain("/api/editor-images?key=editor-images/screenshot.png");
  });

  test("round-trips task lists, including checked state", () => {
    const taskHtml =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><div><p>todo</p></div></li>' +
      "</ul>";

    const html = roundTrip(taskHtml);

    expect(html).toContain('data-type="taskList"');
    expect(html).toContain("done");
    expect(html).toContain("todo");
    expect(html).toContain('data-checked="true"');
  });

  test("emits nothing that sanitizeTipTapHtml would strip", () => {
    // The load-bearing assertion: if the editor emits a tag or attribute outside
    // the allowlist, the user's formatting silently disappears when it is saved.
    const html = roundTrip(V2_STORED_HTML);

    expect(sanitizeTipTapHtml(html)).toBe(html);
  });

  test("emits nothing outside the allowlist for task lists either", () => {
    const taskHtml =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>' +
      "</ul>";

    const html = roundTrip(taskHtml);

    expect(sanitizeTipTapHtml(html)).toBe(html);
  });

  test("does not emit <u>, which the sanitizer would drop", () => {
    // v3's StarterKit bundles Underline; it is disabled because `u` is not in
    // sanitizeTipTapHtml's ALLOWED_TAGS.
    const html = roundTrip("<p><u>underlined</u></p>");

    expect(html).not.toContain("<u>");
    expect(html).toContain("underlined");
  });

  test("does not append a trailing paragraph to stored content", () => {
    // v3's StarterKit bundles TrailingNode; it is disabled because it would
    // change what getHTML() returns and therefore what is written to the DB.
    const html = roundTrip("<p>only paragraph</p>");

    expect(html).toBe("<p>only paragraph</p>");
  });
});
