export function getOAuthBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "https://www.jedforge.com";
}

// Short-lived: PKCE-bound, single-use, exchanged immediately after redirect.
export const AUTHORIZATION_CODE_TTL_MS = 60_000;

// Access tokens are the bearer credential the MCP server checks on every call.
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

// Refresh tokens are rotated on every use (old one revoked, new one issued).
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
