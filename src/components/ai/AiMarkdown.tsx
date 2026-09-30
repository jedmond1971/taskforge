import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an assistant reply as markdown. react-markdown builds React elements (no
 * dangerouslySetInnerHTML), ignores raw HTML in the source, and strips unsafe URL schemes
 * such as javascript:, so this adds no new XSS sink. Styling is compact to fit the chat panel.
 */
const components: ComponentProps<typeof ReactMarkdown>["components"] = {
  p: (props) => <p className="[&:not(:first-child)]:mt-2" {...props} />,
  ul: (props) => <ul className="list-disc pl-4 mt-2 space-y-0.5" {...props} />,
  ol: (props) => <ol className="list-decimal pl-4 mt-2 space-y-0.5" {...props} />,
  h1: (props) => <h3 className="font-semibold text-sm mt-3 first:mt-0" {...props} />,
  h2: (props) => <h3 className="font-semibold text-sm mt-3 first:mt-0" {...props} />,
  h3: (props) => <h4 className="font-semibold mt-3 first:mt-0" {...props} />,
  h4: (props) => <h4 className="font-semibold mt-3 first:mt-0" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => (
    <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  pre: (props) => (
    <pre className="mt-2 overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-[11px]" {...props} />
  ),
  code: ({ className, ...props }) =>
    // Fenced blocks arrive with a language class or inside <pre>; inline code gets the chip style.
    className ? (
      <code className={className} {...props} />
    ) : (
      <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[11px]" {...props} />
    ),
  blockquote: (props) => (
    <blockquote className="mt-2 border-l-2 border-border-soft pl-2 text-muted-foreground" {...props} />
  ),
  table: (props) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border-b border-border-soft px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: (props) => <td className="border-b border-border-soft px-2 py-1" {...props} />,
  hr: () => <hr className="my-2 border-border-soft" />,
};

export function AiMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
