/**
 * Single source of truth for keyboard shortcuts (JFR-177). The help overlay
 * renders from SHORTCUTS, and shortcuts.test.ts guards against two entries
 * claiming the same keys. Handlers still live next to the UI they drive; this
 * only describes them.
 */

export type ShortcutScope = "Global" | "Project" | "Issue";

export interface ShortcutDef {
  id: string;
  /** Key caps in press order. A chord ("G" then "B") is two entries; a combo is joined with "+". */
  keys: string[];
  description: string;
  scope: ShortcutScope;
}

export const SHORTCUT_SCOPES: ShortcutScope[] = ["Global", "Project", "Issue"];

export const SCOPE_HELP: Record<ShortcutScope, string> = {
  Global: "Anywhere in the app",
  Project: "Inside a project",
  Issue: "On an issue page",
};

export const SHORTCUTS: ShortcutDef[] = [
  { id: "palette", keys: ["Ctrl/⌘+K"], description: "Open the command palette", scope: "Global" },
  { id: "search", keys: ["/"], description: "Go to Search", scope: "Global" },
  { id: "help", keys: ["?"], description: "Show keyboard shortcuts", scope: "Global" },
  { id: "create-issue", keys: ["N"], description: "Create an issue", scope: "Project" },
  { id: "go-board", keys: ["G", "B"], description: "Go to Board", scope: "Project" },
  { id: "go-issues", keys: ["G", "I"], description: "Go to Issues", scope: "Project" },
  { id: "go-docs", keys: ["G", "D"], description: "Go to Docs", scope: "Project" },
  { id: "edit-description", keys: ["E"], description: "Edit the description", scope: "Issue" },
  { id: "comment", keys: ["C"], description: "Write a comment", scope: "Issue" },
  { id: "assign", keys: ["A"], description: "Change the assignee", scope: "Issue" },
];

/** How long after "G" the second key of a go-to chord is still accepted. */
export const CHORD_TIMEOUT_MS = 1000;

export const OPEN_SHORTCUTS_EVENT = "jedforge:open-shortcuts";

/** Where a "G then <key>" chord goes, relative to /projects/[key]. */
export const GO_CHORD_TARGETS: Record<string, string> = {
  b: "board",
  i: "issues",
  d: "docs",
};

/**
 * True when a key event must NOT trigger a single-key shortcut: typing in a
 * field, a modifier chord (leave Cmd+C/Ctrl+A etc. to the browser), key-repeat,
 * or an open dialog (so `c` in a confirm dialog doesn't act on the page behind).
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return true;
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  ) {
    return true;
  }
  return typeof document !== "undefined" && document.querySelector('[role="dialog"]') !== null;
}
