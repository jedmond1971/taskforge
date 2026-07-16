import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isAuthRoute = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", nextUrl.pathname);

  if (isApiRoute) return NextResponse.next({ request: { headers: requestHeaders } });

  if (isAuthRoute) {
    if (isLoggedIn) return NextResponse.redirect(new URL("/", nextUrl));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const isInviteRoute = nextUrl.pathname.startsWith("/invite/");
  if (isInviteRoute) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // OAuth consent screen does its own login redirect (preserving the full
  // authorize query string, which the pathname-only callbackUrl below loses),
  // and the well-known metadata endpoints must stay unauthenticated for MCP
  // client discovery.
  const isOAuthAuthorizeRoute = nextUrl.pathname === "/oauth/authorize";
  const isWellKnownRoute = nextUrl.pathname.startsWith("/.well-known/");
  if (isOAuthAuthorizeRoute || isWellKnownRoute) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
