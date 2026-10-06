"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  Archive,
  BookOpen,
  Building2,
  CircleDot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Monitor,
  Moon,
  Plus,
  Keyboard,
  Search,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { cn } from "@/lib/utils";
import { OPEN_SHORTCUTS_EVENT } from "@/lib/shortcuts";
import {
  PALETTE_RECENT_KEY,
  availableCommands,
  filterCommands,
  isSafeRecent,
  isSearchable,
  normalizeQuery,
  projectKeyFromPath,
  pushRecent,
  type PaletteCommand,
  type PaletteCommandId,
  type RecentItem,
} from "@/lib/command-palette";
import { paletteSearch, type PaletteSearchResult } from "@/app/(dashboard)/command-palette-actions";

export const OPEN_PALETTE_EVENT = "jedforge:open-palette";
export const CREATE_ISSUE_EVENT = "jedforge:create-issue";

const DEBOUNCE_MS = 150;

type Hits = Extract<PaletteSearchResult, { ok: true }>;
type SearchState = "idle" | "loading" | "error";

type Item =
  | { type: "command"; id: string; command: PaletteCommand }
  | { type: "result"; id: string; recent: RecentItem; status?: Hits["issues"][number] };

interface Group {
  label: string;
  items: Item[];
}

const COMMAND_ICONS: Record<PaletteCommandId, React.ComponentType<{ className?: string }>> = {
  "go-dashboard": LayoutDashboard,
  "go-search": Search,
  "go-docs": BookOpen,
  "go-projects": FolderKanban,
  "go-closed": Archive,
  "go-settings": Settings,
  "go-org-settings": Building2,
  "go-admin": ShieldCheck,
  "create-issue": Plus,
  "show-shortcuts": Keyboard,
  "theme-light": Sun,
  "theme-dark": Moon,
  "theme-system": Monitor,
};

const KIND_ICONS = { project: FolderKanban, issue: CircleDot, doc: FileText } as const;

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(PALETTE_RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isSafeRecent) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentItem[]): void {
  try {
    localStorage.setItem(PALETTE_RECENT_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage errors
  }
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState<{ q: string; res: PaletteSearchResult } | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const requestId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const openPalette = useCallback(() => {
    setQuery("");
    setIndex(0);
    setSettled(null);
    setRecent(loadRecent());
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    requestId.current++; // invalidate any in-flight search
    setOpen(false);
  }, []);

  // Global Cmd/Ctrl+K toggle and the open event used by the header trigger.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      // TipTap (StarterKit's Link) does not bind Mod-k today, so the palette is
      // allowed from inside the editor too; revisit if a link shortcut is added.
      e.preventDefault();
      if (e.repeat) return;
      if (open) closePalette();
      else openPalette();
    }
    function onOpenEvent() {
      openPalette();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    };
  }, [open, openPalette, closePalette]);

  const trimmed = normalizeQuery(query);
  const searching = isSearchable(trimmed);

  // Debounced server search. A monotonically increasing id discards stale
  // responses; the settled result carries the query it answered, so "loading"
  // is derived (no synchronous setState in the effect).
  useEffect(() => {
    const id = ++requestId.current;
    if (!open || !searching) return;
    const timer = setTimeout(async () => {
      let res: PaletteSearchResult;
      try {
        res = await paletteSearch(trimmed);
      } catch {
        res = { ok: false, error: "failed" };
      }
      if (id === requestId.current) setSettled({ q: trimmed, res });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searching, open]);

  const current = searching && settled?.q === trimmed ? settled.res : null;
  const searchState: SearchState = !searching ? "idle" : !current ? "loading" : current.ok ? "idle" : "error";
  // Keep showing the previous answer while the next one loads (no layout jump).
  const hits: Hits | null = searching && settled?.res.ok ? settled.res : null;

  const groups = useMemo<Group[]>(() => {
    const q = trimmed;
    const commands = filterCommands(
      availableCommands({
        isAdmin: session?.user?.role === "ADMIN",
        projectKey: projectKeyFromPath(pathname),
      }),
      q
    );
    let n = 0;
    const nextId = () => `palette-opt-${n++}`;
    const toCommandItems = (): Item[] => commands.map((command) => ({ type: "command", id: nextId(), command }));
    const out: Group[] = [];

    if (!q) {
      out.push({ label: "Commands", items: toCommandItems() });
      if (recent.length) {
        out.push({
          label: "Recent",
          items: recent.map((r) => ({ type: "result", id: nextId(), recent: r })),
        });
      }
      return out;
    }

    // With a query, matches in the user's data come before commands.
    const resultGroups: Group[] = [];
    if (hits) {
      if (hits.issues.length) {
        resultGroups.push({
          label: "Issues",
          items: hits.issues.map((i) => ({
            type: "result",
            id: "",
            status: i,
            recent: {
              kind: "issue",
              title: i.title,
              subtitle: i.key,
              href: `/projects/${i.projectKey}/issues/${i.key}`,
            },
          })),
        });
      }
      if (hits.projects.length) {
        resultGroups.push({
          label: "Projects",
          items: hits.projects.map((p) => ({
            type: "result",
            id: "",
            recent: { kind: "project", title: p.name, subtitle: p.key, href: `/projects/${p.key}` },
          })),
        });
      }
      if (hits.docs.length) {
        resultGroups.push({
          label: "Docs",
          items: hits.docs.map((d) => ({
            type: "result",
            id: "",
            recent: {
              kind: "doc",
              title: d.title,
              subtitle: d.sectionTitle ? `${d.projectKey} · ${d.sectionTitle}` : d.projectKey,
              href: `/projects/${d.projectKey}/docs/${d.id}`,
            },
          })),
        });
      }
    }
    for (const g of resultGroups) for (const item of g.items) item.id = nextId();
    out.push(...resultGroups);
    const commandItems = toCommandItems();
    if (commandItems.length) out.push({ label: "Commands", items: commandItems });
    return out;
  }, [trimmed, hits, recent, session, pathname]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeIndex = flat.length ? Math.min(index, flat.length - 1) : -1;
  const activeId = activeIndex >= 0 ? flat[activeIndex].id : undefined;

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function activate(item: Item) {
    if (item.type === "result") {
      saveRecent(pushRecent(loadRecent(), item.recent));
      closePalette();
      router.push(item.recent.href);
      return;
    }
    const { command } = item;
    closePalette();
    if (command.href) {
      router.push(command.href);
    } else if (command.id === "create-issue") {
      // Let the palette dialog finish closing (and restore focus) first.
      setTimeout(() => window.dispatchEvent(new CustomEvent(CREATE_ISSUE_EVENT)), 0);
    } else if (command.id === "show-shortcuts") {
      setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT)), 0);
    } else if (command.id.startsWith("theme-")) {
      setTheme(command.id.slice("theme-".length));
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setIndex((activeIndex + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (e.repeat || activeIndex < 0) return;
      e.preventDefault();
      activate(flat[activeIndex]);
    }
  }

  const noResults = searching && searchState === "idle" && flat.length === 0;
  const announcement = searchState === "loading"
    ? "Searching"
    : flat.length === 0
      ? noResults ? "No results" : ""
      : `${flat.length} result${flat.length === 1 ? "" : "s"} available`;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openPalette() : closePalette())}>
      <DialogContent
        showCloseButton={false}
        className="top-[8%] sm:top-[18%] -translate-y-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="-m-4 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 border-b border-border-soft">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="palette-listbox"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label="Search projects, issues and docs, or run a command"
              placeholder="Search projects, issues, docs, or run a command…"
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
              className="flex-1 h-12 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-muted-foreground transition-opacity",
                searchState === "loading" ? "opacity-100 animate-pulse" : "opacity-0"
              )}
            />
          </div>

          <div
            ref={listRef}
            id="palette-listbox"
            role="listbox"
            aria-label="Results"
            className="max-h-[min(60dvh,24rem)] overflow-y-auto p-1.5"
          >
            {groups.map((group) => {
              const headingId = `palette-group-${group.label.toLowerCase()}`;
              return (
                <div key={group.label} role="group" aria-labelledby={headingId} className="mb-1 last:mb-0">
                  <div
                    id={headingId}
                    role="presentation"
                    className="px-2 pt-2 pb-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <PaletteRow
                      key={item.id}
                      item={item}
                      selected={item.id === activeId}
                      onHover={() => setIndex(flat.findIndex((f) => f.id === item.id))}
                      onActivate={() => activate(item)}
                    />
                  ))}
                </div>
              );
            })}
            {noResults && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No results for “{trimmed}”
              </p>
            )}
            {searchState === "error" && (
              <p className="px-3 py-2 text-xs text-danger">
                Search is unavailable right now. Commands still work.
              </p>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-4 px-3 py-2 border-t border-border-soft text-xs text-muted-foreground">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
          <div className="sr-only" aria-live="polite" role="status">
            {announcement}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteRow({
  item,
  selected,
  onHover,
  onActivate,
}: {
  item: Item;
  selected: boolean;
  onHover: () => void;
  onActivate: () => void;
}) {
  let Icon: React.ComponentType<{ className?: string }>;
  let primary: string;
  let secondary: string | null = null;
  let hint: React.ReactNode = null;

  if (item.type === "command") {
    Icon = COMMAND_ICONS[item.command.id];
    primary = item.command.label;
  } else {
    Icon = KIND_ICONS[item.recent.kind];
    primary = item.recent.title;
    secondary = item.recent.subtitle;
    if (item.status) {
      hint = <StatusBadge status={{ name: item.status.statusName, category: item.status.statusCategory }} />;
    }
  }

  return (
    <div
      id={item.id}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onMouseDown={(e) => e.preventDefault()} // keep focus in the input
      onClick={onActivate}
      className={cn(
        "flex items-center gap-2.5 min-h-11 sm:min-h-9 px-2 py-1.5 rounded-lg cursor-pointer text-sm",
        selected ? "bg-surface-active text-foreground" : "text-foreground/90"
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      {secondary && <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">{secondary}</span>}
      <span className="truncate flex-1 min-w-0">{primary}</span>
      {hint && <span className="flex-shrink-0">{hint}</span>}
    </div>
  );
}
