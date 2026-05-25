# Rich Text (TipTap)

Issue descriptions and comment bodies are stored as **HTML strings** in the database (existing `String` fields handle this without schema changes).

## Empty state
Empty editor state is normalized to `""` (not `"<p></p>"`), so existing `|| null` / `|| undefined` checks continue to work.

## Plain-text fallback
Existing plain-text content is rendered correctly by `RichTextDisplay` via a `toSafeHtml()` fallback that wraps non-HTML strings in `<p>` tags.

## Styles
ProseMirror + prose styles are in `src/app/globals.css` under the `/* Rich text editor */` comment block.

## TipTap packages
`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-placeholder`

## Toolbar features
Bold, italic, strike, H2/H3, bullet/numbered/task lists, code, blockquote, link, HR.
