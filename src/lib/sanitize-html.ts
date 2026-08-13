import DOMPurify from "isomorphic-dompurify";

// Allowed tags and attributes that TipTap legitimately produces.
// This list covers StarterKit + Image + Link + TaskList + TaskItem extensions.
const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "s", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "hr",
  "a", "img",
  "input",  // TipTap TaskItem renders as <input type="checkbox">
  "div", "span",
];

const ALLOWED_ATTR = [
  "href", "target", "rel",  // links
  "src", "alt",              // images
  "type", "checked",         // checkboxes
  "class", "data-type",      // TipTap uses these for TaskList
];

export function sanitizeTipTapHtml(html: string): string {
  if (!html || !html.trim()) return html;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Force links to be safe
    FORCE_BODY: false,
  });
}

// Separate, looser allowlist for mammoth-converted DOCX preview HTML — real
// Word docs use tables, sup/sub, etc. that TipTap never produces, so this is
// purpose-built rather than loosening ALLOWED_TAGS above (which backs
// issue/comment/doc content and should stay tight).
const DOCX_ALLOWED_TAGS = [
  "p", "br", "strong", "em", "s", "u", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "hr",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
  "sup", "sub",
  "div", "span",
];

const DOCX_ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "class", "colspan", "rowspan"];

export function sanitizeDocxPreviewHtml(html: string): string {
  if (!html || !html.trim()) return html;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCX_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCX_ALLOWED_ATTR,
    FORCE_BODY: false,
  });
}
