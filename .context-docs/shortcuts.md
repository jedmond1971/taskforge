# Keyboard Shortcuts

All single-key shortcuts (`/`, `N`) are suppressed when focus is inside an `INPUT`, `TEXTAREA`, or a `contenteditable` element.

## Global (registered in `DashboardShell`)
- `Cmd/Ctrl+K` — toggle the command palette (`CommandPalette`, mounted in `DashboardShell`, JFR-176). Unlike `/` and `N` it is **not** suppressed in inputs or `contenteditable`, because it is a modified chord: the TipTap editor (StarterKit's Link) binds no `Mod-k`, so there is nothing to conflict with. If a link shortcut is ever added to the editor, bail out of the palette handler when `target.isContentEditable`. `preventDefault` is called only when the chord is handled.
- `jedforge:open-palette` (window `CustomEvent`) — opens the palette; used by the Header search button. Other code should dispatch this rather than reaching into the component.
- `jedforge:create-issue` (window `CustomEvent`) — opens CreateIssueDialog for the current project; listened to by `ProjectShortcuts` (same dialog as `N`). The palette's "Create issue" command fires it after closing.
- `/` — navigate to `/search` (or fire `jedforge:focus-search` custom event if already there)

## Project-context (registered via `ProjectShortcuts`, injected into the project layout)
- `N` — open CreateIssueDialog for the current project

## Adding a shortcut
There is no shared registry yet: each shortcut is an ad-hoc `keydown` listener. A shortcut-help overlay (JFR-177) would need one (id, keys, description, scope, suppression rule) that these listeners register into.
