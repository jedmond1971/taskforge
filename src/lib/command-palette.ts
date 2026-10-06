/**
 * Pure helpers for the global command palette (JFR-176). Kept free of React and
 * Prisma so both the client component and the server action can share them and
 * the unit tests can drive them directly.
 */

export const PALETTE_MIN_QUERY = 2;
export const PALETTE_MAX_QUERY = 100;

const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Trim and cap length. The result is plain text — it is never parsed as FQL. */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, PALETTE_MAX_QUERY);
}

export function isSearchable(query: string): boolean {
  return query.length >= PALETTE_MIN_QUERY;
}

/** Returns the upper-cased issue key if the query looks like one, else null. */
export function detectIssueKey(query: string): string | null {
  const q = query.trim();
  return ISSUE_KEY_RE.test(q) ? q.toUpperCase() : null;
}

export type PaletteCommandId =
  | "go-dashboard"
  | "go-search"
  | "go-docs"
  | "go-projects"
  | "go-settings"
  | "go-closed"
  | "go-org-settings"
  | "go-admin"
  | "create-issue"
  | "theme-light"
  | "theme-dark"
  | "theme-system";

export interface PaletteCommand {
  id: PaletteCommandId;
  label: string;
  keywords: string;
  href?: string;
}

export interface PaletteCommandContext {
  isAdmin: boolean;
  /** Project key when the current path is inside /projects/[key]/..., else null. */
  projectKey: string | null;
}

const ALL_COMMANDS: PaletteCommand[] = [
  { id: "go-dashboard", label: "Go to Dashboard", keywords: "home overview", href: "/" },
  { id: "go-search", label: "Go to Search", keywords: "find query filter", href: "/search" },
  { id: "go-docs", label: "Go to Docs", keywords: "documentation pages wiki", href: "/docs" },
  { id: "go-projects", label: "Go to Projects", keywords: "boards", href: "/projects" },
  { id: "go-closed", label: "Go to Closed projects", keywords: "archived inactive", href: "/projects/closed" },
  { id: "go-settings", label: "Go to Settings", keywords: "preferences account", href: "/settings" },
  { id: "go-org-settings", label: "Go to Org Settings", keywords: "organization members groups", href: "/org-settings" },
  { id: "go-admin", label: "Go to Admin", keywords: "administration users orgs", href: "/admin" },
  { id: "create-issue", label: "Create issue", keywords: "new add ticket task bug" },
  { id: "theme-light", label: "Theme: Light", keywords: "appearance mode" },
  { id: "theme-dark", label: "Theme: Dark", keywords: "appearance mode night" },
  { id: "theme-system", label: "Theme: System", keywords: "appearance mode auto" },
];

/** The commands this user can see in this location, before query filtering. */
export function availableCommands(ctx: PaletteCommandContext): PaletteCommand[] {
  return ALL_COMMANDS.filter((c) => {
    if (c.id === "go-admin") return ctx.isAdmin;
    if (c.id === "create-issue") return ctx.projectKey !== null;
    return true;
  });
}

/** Case-insensitive match: every whitespace-separated term must appear in label or keywords. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return commands;
  return commands.filter((c) => {
    const hay = `${c.label} ${c.keywords}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Project key from a pathname like /projects/ABC/issues/ABC-1; null for /projects, /projects/closed. */
export function projectKeyFromPath(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!m) return null;
  return m[1] === "closed" ? null : decodeURIComponent(m[1]).toUpperCase();
}

export type PaletteResultKind = "project" | "issue" | "doc";

export interface RecentItem {
  kind: PaletteResultKind;
  title: string;
  subtitle: string;
  href: string;
}

export const PALETTE_RECENT_KEY = "jedforge-palette-recent";
export const PALETTE_RECENT_MAX = 5;

/** Only same-origin app paths are ever followed from stored data. */
export function isSafeRecent(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    (r.kind === "project" || r.kind === "issue" || r.kind === "doc") &&
    typeof r.title === "string" &&
    typeof r.subtitle === "string" &&
    typeof r.href === "string" &&
    r.href.startsWith("/") &&
    !r.href.startsWith("//")
  );
}

export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => r.href !== item.href)].slice(0, PALETTE_RECENT_MAX);
}
