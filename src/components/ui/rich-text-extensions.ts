import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";

/**
 * The editor's extension set, kept out of the component so it can be driven
 * headlessly by rich-text-extensions.test.ts. That test is the guard on the two
 * things a TipTap upgrade can silently break: previously-stored HTML still
 * loading, and getHTML() only emitting what sanitizeTipTapHtml() allows.
 */
export function buildEditorExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // v3's StarterKit bundles Link. Configure it here rather than also
      // registering @tiptap/extension-link — a double registration would make it
      // undefined which copy wins, and this one carries the rel hardening.
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
      // v3 additions, both disabled to keep v2 behaviour:
      // - underline: sanitizeTipTapHtml() has no `u` in ALLOWED_TAGS, so the
      //   toolbar would produce formatting silently dropped on save.
      // - trailingNode: appends a paragraph node to the document, changing
      //   getHTML() output and therefore what gets stored. Worth having, but as
      //   its own UX decision, not smuggled in on a security upgrade.
      underline: false,
      trailingNode: false,
    }),
    Image.configure({ inline: false, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
  ];
}
