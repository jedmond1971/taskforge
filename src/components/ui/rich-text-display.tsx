/**
 * Read-only renderer for rich text HTML stored in the database.
 * Handles plain-text fallback gracefully.
 */

interface RichTextDisplayProps {
  content: string;
  className?: string;
}

function toSafeHtml(content: string): string {
  // If content doesn't look like HTML, treat it as plain text
  if (!content.includes("<")) {
    return content
      .split("\n\n")
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  return content;
}

export function RichTextDisplay({ content, className = "" }: RichTextDisplayProps) {
  return (
    <div
      className={`rich-prose text-sm text-zinc-700 dark:text-zinc-300 ${className}`}
      dangerouslySetInnerHTML={{ __html: toSafeHtml(content) }}
    />
  );
}
