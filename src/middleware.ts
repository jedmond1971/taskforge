import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import { REQUEST_ID_HEADER, normalizeRequestId } from "@/lib/request-id";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isAuthRoute = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", nextUrl.pathname);

  // SECH-114: one correlation ID per request, forwarded to handlers and echoed on the
  // response so a report can be tied back to its log lines. Inbound values are validated
  // in normalizeRequestId — an unvalidated header would be a log-injection vector.
  const requestId = normalizeRequestId(req.headers.get(REQUEST_ID_HEADER));
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const withRequestId = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  if (isApiRoute) return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));

  if (isAuthRoute) {
    if (isLoggedIn) return withRequestId(NextResponse.redirect(new URL("/", nextUrl)));
    return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  const isInviteRoute = nextUrl.pathname.startsWith("/invite/");
  if (isInviteRoute) {
    return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // OAuth consent screen does its own login redirect (preserving the full
  // authorize query string, which the pathname-only callbackUrl below loses),
  // and the well-known metadata endpoints must stay unauthenticated for MCP
  // client discovery.
  const isOAuthAuthorizeRoute = nextUrl.pathname === "/oauth/authorize";
  const isWellKnownRoute = nextUrl.pathname.startsWith("/.well-known/");
  if (isOAuthAuthorizeRoute || isWellKnownRoute) {
    return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return withRequestId(NextResponse.redirect(loginUrl));
  }

  return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
