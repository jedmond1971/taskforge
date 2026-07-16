import { NextResponse } from "next/server";
import { getOAuthBaseUrl } from "@/lib/oauth/config";
import { ALL_OAUTH_SCOPES } from "@/lib/oauth/scopes";

// RFC 8414. Served at /.well-known/oauth-authorization-server via the rewrite
// in next.config.mjs — see that file for why this isn't a literal dot-folder.
export async function GET() {
  const baseUrl = getOAuthBaseUrl();

  return NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ALL_OAUTH_SCOPES,
  });
}
