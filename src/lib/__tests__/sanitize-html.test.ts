// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import { sanitizeTipTapHtml } from "../sanitize-html";

// SECH-124 widened ALLOWED_TAGS with `label` so TipTap's task-list markup stops
// being mangled on save. These pin what the allowlist must still refuse, so a
// future widening can't quietly take the teeth out of it.

describe("sanitizeTipTapHtml", () => {
  test("keeps the task-list markup the editor actually emits", () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-checked="true" data-type="taskItem">' +
      '<label><input type="checkbox" checked="checked"><span></span></label>' +
      "<div><p>done</p></div></li></ul>";

    expect(sanitizeTipTapHtml(html)).toBe(html);
  });

  test("strips script elements", () => {
    const out = sanitizeTipTapHtml('<p>hi</p><script>alert(1)</script>');

    expect(out).not.toContain("script");
    expect(out).toContain("<p>hi</p>");
  });

  test("strips inline event handlers, including on the newly allowed label", () => {
    const out = sanitizeTipTapHtml('<label onclick="alert(1)">click</label>');

    expect(out).not.toContain("onclick");
    expect(out).toContain("click");
  });

  test("strips a label's `for` attribute, which is not in the allowlist", () => {
    const out = sanitizeTipTapHtml('<label for="something">text</label>');

    expect(out).not.toContain("for=");
  });

  test("strips javascript: URLs on links", () => {
    const out = sanitizeTipTapHtml('<a href="javascript:alert(1)">x</a>');

    expect(out).not.toContain("javascript:");
  });

  test("strips iframes and object embeds", () => {
    const out = sanitizeTipTapHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object>',
    );

    expect(out).not.toContain("iframe");
    expect(out).not.toContain("object");
  });

  test("strips style attributes and elements", () => {
    const out = sanitizeTipTapHtml(
      '<p style="position:fixed;top:0">x</p><style>body{display:none}</style>',
    );

    expect(out).not.toContain("style");
    expect(out).toContain("x");
  });

  test("leaves empty input untouched", () => {
    expect(sanitizeTipTapHtml("")).toBe("");
    expect(sanitizeTipTapHtml("   ")).toBe("   ");
  });
});
