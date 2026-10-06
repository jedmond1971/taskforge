# Keyboard Shortcuts

`src/lib/shortcuts.ts` is the registry (`SHORTCUTS`: id, keys, description, scope). The `?` help overlay (`ShortcutHelp`, JFR-177) renders from it and `shortcuts.test.ts` guards against duplicate keys, so **add every new shortcut there too**. Handlers still live next to the UI they drive — the registry only describes them.

## Suppression rules (all single-key shortcuts)
`shouldIgnoreShortcut(e)` in `src/lib/shortcuts.ts` — shared by `useShortcut` (`src/components/layout/use-shortcut.ts`) and the G-chord. A shortcut does nothing when:
- focus is in an `INPUT`, `TEXTAREA`, `SELECT` or `contenteditable`;
- Ctrl/Cmd/Alt is held (leave browser chords alone) or the key is auto-repeating;
- any `[role="dialog"]` is in the DOM (confirm dialogs, the palette, Create Issue, this overlay). Note Base UI keeps the dialog mounted for its ~100ms exit animation, so a key pressed instantly after Esc is ignored — only matters for scripted input.

`preventDefault` is called only when a shortcut actually fires. Use `useShortcut(key, handler, enabled)` for new single keys (matches `e.key` case-insensitively, Shift allowed, so `"?"` works).

## Global (`DashboardShell`)
- `Cmd/Ctrl+K` — toggle the command palette (`CommandPalette`, JFR-176). A modified chord, so it is deliberately **not** subject to the rules above: it works inside inputs and `contenteditable`, because TipTap (StarterKit's Link) binds no `Mod-k`. If a link shortcut is ever added to the editor, bail out of the palette handler when `target.isContentEditable`.
- `/` — go to `/search` (or fire `jedforge:focus-search` if already there)
- `?` — open `ShortcutHelp`

## Project (`ProjectShortcuts`, injected by the project layout)
- `N` — Create Issue dialog
- `G` then `B` / `I` / `D` — go to `/projects/[key]/board` | `issues` | `docs`. `G` arms a chord for `CHORD_TIMEOUT_MS` (1s); any other key cancels it. Sprint-mode `Backlog` has no chord. Plain `G` itself is reserved as the chord prefix (tested).

## Issue page (`IssueDetail` / `CommentForm`)
- `E` — edit the description (only if `canEdit`; focuses the editor)
- `C` — focus the comment editor
- `A` — focus/open the assignee picker (only if `canEdit`)

## Window events
- `jedforge:open-palette` — opens the palette (Header search button). Dispatch it rather than reaching into the component.
- `jedforge:create-issue` — opens CreateIssueDialog for the current project (`ProjectShortcuts` listens; the palette's "Create issue" fires it after closing).
- `jedforge:open-shortcuts` — opens `ShortcutHelp` (the palette's "Keyboard shortcuts" command fires it).
- `jedforge:focus-search` — focuses the search box on `/search`.
