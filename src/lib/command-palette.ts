/**
 * Pure helpers for the global command palette (JFR-176). Kept free of React and
 * Prisma so both the client component and the server action can share them and
 * the unit tests can drive them directly.
 */

export const PALETTE_MIN_QUERY = 2;
export const PALETTE_MAX_QUERY = 100;
/** Content (description / comment / doc body) search starts one character later than title search — two-letter substrings match nearly every body. */
export const PALETTE_CONTENT_MIN_QUERY = 3;

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

export function isContentSearchable(query: string): boolean {
  return query.length >= PALETTE_CONTENT_MIN_QUERY;
}

/** Raw HTML scanned per row; a match past this is not found, which keeps one huge page from dominating a query. */
export const SNIPPET_MAX_SCAN = 50_000;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * TipTap HTML to plain text. Block boundaries become spaces so adjacent paragraphs don't fuse
 * into one word; inline tags vanish. Entities are decoded AFTER tags are removed, so an escaped
 * "&lt;script&gt;" survives as literal text — the result is only ever rendered as text, never markup.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .slice(0, SNIPPET_MAX_SCAN)
      .replace(/<\/?(?:p|div|li|ul|ol|br|hr|h[1-6]|blockquote|pre|label)\b[^>]*>/gi, " ")
      .replace(/<[^>]*>?/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A short window of the plain text around the first case-insensitive occurrence of `query`, split
 * so the client can emphasise `match` without parsing anything. Returns null when the stripped
 * text does not contain the query (the SQL match was on tag or attribute text).
 */
export function buildSnippet(html: string | null | undefined, query: string): Snippet | null {
  if (!html || !query) return null;
  const text = htmlToText(html);
  const m = new RegExp(escapeRegExp(query), "i").exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - SNIPPET_BEFORE);
  const end = Math.min(text.length, m.index + m[0].length + SNIPPET_AFTER);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, m.index),
    match: m[0],
    after: text.slice(m.index + m[0].length, end) + (end < text.length ? "…" : ""),
  };
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
  | "show-shortcuts"
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
  { id: "show-shortcuts", label: "Keyboard shortcuts", keywords: "help keys hotkeys ?" },
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
