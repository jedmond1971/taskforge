// Tool surface for the future Phase B2 MCP server (JFR-100). Scopes are enforced
// there, not here — Phase B1 only issues and records the grant.
export const OAUTH_SCOPES = {
  "issues:write": "Create and update issues",
  "search:read": "Search issues and projects",
  "docs:read": "Read documentation pages",
  "docs:write": "Create and edit documentation pages",
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPES;

export const ALL_OAUTH_SCOPES = Object.keys(OAUTH_SCOPES) as OAuthScope[];

function isOAuthScope(value: string): value is OAuthScope {
  return value in OAUTH_SCOPES;
}

// Unrecognized scope tokens are dropped rather than rejected — an empty/absent
// request defaults to the full supported set (mirrors DCR clients that don't
// send a scope param at all).
export function parseRequestedScope(scope: string | null | undefined): OAuthScope[] {
  if (!scope) return ALL_OAUTH_SCOPES;
  const requested = scope.split(/\s+/).filter(Boolean).filter(isOAuthScope);
  return requested.length > 0 ? requested : ALL_OAUTH_SCOPES;
}
