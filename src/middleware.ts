import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import { blockedBySwitch } from "@/lib/kill-switches";
import { REQUEST_ID_HEADER, normalizeRequestId } from "@/lib/request-id";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isAuthRoute =
    nextUrl.pathname.startsWith("/login") ||
    nextUrl.pathname.startsWith("/register") ||
    nextUrl.pathname.startsWith("/forgot-password");
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

  // SECH-118: operator kill switches. Answered before auth and before any handler, so a
  // disabled surface has no side effects. 503 (not 404) because the routes do exist.
  const blocked = blockedBySwitch(nextUrl.pathname, req.method);
  if (blocked) {
    if (isApiRoute || nextUrl.pathname.startsWith("/.well-known/")) {
      return withRequestId(
        NextResponse.json(
          { error: "This feature is temporarily disabled.", code: "feature_disabled" },
          { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } },
        ),
      );
    }
    return withRequestId(
      new NextResponse("This feature is temporarily disabled.", {
        status: 503,
        headers: { "Retry-After": "300", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  }

  if (isApiRoute) return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));

  if (isAuthRoute) {
    if (isLoggedIn) return withRequestId(NextResponse.redirect(new URL("/", nextUrl)));
    return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // Reachable signed in or out: a reset link opened in a browser that still has a session must work,
  // and finishing it invalidates that session anyway.
  const isInviteRoute = nextUrl.pathname.startsWith("/invite/") || nextUrl.pathname.startsWith("/reset-password/");
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
