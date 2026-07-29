import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireOAuthToken } from "@/lib/oauth/require-oauth-token";
import { createMcpServer } from "@/lib/mcp/server";

// Stateless: a fresh transport + server per request, scoped to the caller's
// OAuth context via closure. No cross-request session state to keep in sync
// if Railway ever runs more than one instance (same reasoning as the
// in-memory external-API rate limiter documented elsewhere).
async function handle(request: NextRequest) {
  const ctx = await requireOAuthToken(request);
  if (ctx instanceof NextResponse) return ctx;

  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer(ctx);
  await server.connect(transport);

  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
