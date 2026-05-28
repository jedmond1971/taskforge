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
