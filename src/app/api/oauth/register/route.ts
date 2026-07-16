import { NextResponse } from "next/server";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { prisma } from "@/lib/prisma";
import { generateOAuthClientSecret, hashOAuthSecret } from "@/lib/oauth/tokens";

// RFC 7591 Dynamic Client Registration. Claude.ai's MCP connector calls this
// automatically before starting the authorization flow — no manual client
// setup is expected.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const parsed = OAuthClientMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error.message },
      { status: 400 }
    );
  }

  const metadata = parsed.data;
  const redirectUris = metadata.redirect_uris ?? [];
  if (redirectUris.length === 0) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris is required" },
      { status: 400 }
    );
  }

  // Public clients (PKCE-only, no secret) are the default DCR path Claude.ai's
  // client uses. Only issue a secret when the client explicitly asks for one.
  const tokenEndpointAuthMethod = metadata.token_endpoint_auth_method ?? "none";
  const isConfidential = tokenEndpointAuthMethod !== "none";
  const plaintextSecret = isConfidential ? generateOAuthClientSecret() : null;

  const client = await prisma.oAuthClient.create({
    data: {
      clientName: metadata.client_name ?? null,
      redirectUris,
      tokenEndpointAuthMethod,
      grantTypes: metadata.grant_types ?? ["authorization_code", "refresh_token"],
      clientSecretHash: plaintextSecret ? hashOAuthSecret(plaintextSecret) : null,
    },
  });

  return NextResponse.json(
    {
      client_id: client.id,
      ...(plaintextSecret ? { client_secret: plaintextSecret } : {}),
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      grant_types: client.grantTypes,
      response_types: ["code"],
    },
    { status: 201 }
  );
}
