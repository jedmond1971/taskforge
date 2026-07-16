import { NextResponse } from "next/server";
import { getOAuthBaseUrl } from "@/lib/oauth/config";
import { ALL_OAUTH_SCOPES } from "@/lib/oauth/scopes";

// RFC 9728. "resource" names the future Phase B2 MCP endpoint (JFR-100) — the
// MCP server itself doesn't exist yet, but Claude.ai caches discovery for
// ~5 minutes and the authorization server is what Phase B1 actually delivers.
export async function GET() {
  const baseUrl = getOAuthBaseUrl();

  return NextResponse.json({
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ALL_OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
  });
}
