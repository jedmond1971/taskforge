# Rich Text (TipTap)

Issue descriptions and comment bodies are stored as **HTML strings** in the database (existing `String` fields handle this without schema changes).

## Empty state
Empty editor state is normalized to `""` (not `"<p></p>"`), so existing `|| null` / `|| undefined` checks continue to work.

## Plain-text fallback
Existing plain-text content is rendered correctly by `RichTextDisplay` via a `toSafeHtml()` fallback that wraps non-HTML strings in `<p>` tags.

## Styles
ProseMirror + prose styles are in `src/app/globals.css` under the `/* Rich text editor */` comment block.

## TipTap packages (v3 since SECH-124, 2026-09-23)
`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-placeholder`, `@tiptap/extension-image`

**All `@tiptap/*` packages must move in lockstep.** v3 pins its internal peers to an *exact* version (`peer @tiptap/pm@"3.31.3"`, not a range), so bumping a subset fails `npm ci` with `ERESOLVE`. That is why individual Dependabot PRs for single TipTap packages are unmergeable — they have to be superseded by one coordinated bump of every `@tiptap/*` dependency.

**`@tiptap/extension-link` is no longer a direct dependency** — v3's StarterKit bundles Link, so it is configured via `StarterKit.configure({ link: {...} })`. Registering the standalone extension *as well* would double-register it, leaving it undefined which copy wins — and this project's copy carries the `rel="noopener noreferrer"` hardening, so that matters.

**Two v3 StarterKit additions are deliberately disabled** in `rich-text-extensions.ts`:
- `underline: false` — `sanitizeTipTapHtml()` has no `u` in `ALLOWED_TAGS`, so the toolbar would produce formatting that is silently dropped on save.
- `trailingNode: false` — it appends a paragraph node, changing `getHTML()` output and therefore what is written to the DB. Worth having, but as its own UX decision.

`useEditor` sets `immediatelyRender: false`; v3 defaults it to `true`, which mismatches Next's server render of the client component.

**The extension set lives in `src/components/ui/rich-text-extensions.ts`, not in the component**, so `rich-text-extensions.test.ts` can drive the real configuration headlessly. That test is the guard on the two things a TipTap upgrade breaks silently: previously-stored HTML still loading, and `getHTML()` only emitting what the sanitizer keeps. Extend it rather than trusting a type check — neither failure mode is visible to `tsc` or the build.

## Toolbar features
Bold, italic, strike, H2/H3, bullet/numbered/task lists, code, blockquote, link, HR.

## Inline images (paste support)
Pasting a screenshot or image file into the editor uploads it to S3 via `POST /api/editor-images` and inserts an `<img src="/api/editor-images?key=editor-images/...">` tag. The GET route proxies a presigned S3 download URL (auth-gated; key must start with `editor-images/`). Images are stored under the `editor-images/` S3 prefix and are not tracked in the database.
