import NextAuth, { type Session } from "next-auth";
import { redirect } from "next/navigation";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { authConfig } from "./auth.config";
import { checkLoginRateLimit, recordLoginFailure, getClientIp, logAuthFailure } from "./rate-limit";

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).trim().toLowerCase();
        const ip = getClientIp(request);

        const limit = await checkLoginRateLimit(ip, email);
        if (!limit.allowed) {
          logAuthFailure({ scope: "login", reason: "rate_limited", email, ip });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        const passwordMatch = user
          ? await bcrypt.compare(credentials.password as string, user.passwordHash)
          : false;

        if (!user || !passwordMatch) {
          await recordLoginFailure(ip, email);
          logAuthFailure({ scope: "login", reason: "invalid_credentials", email, ip });
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.avatarUrl,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion;
        const membership = await prisma.orgMember.findFirst({
          where: { userId: user.id! },
          orderBy: { createdAt: "asc" },
          select: { orgId: true },
        });
        token.orgId = membership?.orgId;
      }

      if (trigger === "update") {
        if ((session as { image?: string })?.image) {
          token.picture = (session as { image?: string }).image;
        }
        const membership = await prisma.orgMember.findFirst({
          where: { userId: token.id as string },
          orderBy: { createdAt: "asc" },
          select: { orgId: true },
        });
        if (membership) token.orgId = membership.orgId;
      }

      // Check sessionVersion on every invocation where a session exists.
      // This is the core invalidation mechanism: if the DB version has advanced
      // past the token's version, the token is dead until the user signs in again.
      if (token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { sessionVersion: true },
        });

        if (!fresh || fresh.sessionVersion !== token.sessionVersion) {
          token.invalidated = true;
          // Leave token.sessionVersion stale so the mismatch persists.
        } else {
          token.invalidated = false;
        }

        // On a deliberate session.update() call (e.g. after self-service password
        // change) re-arm this token with the current DB version so it stays valid.
        if (trigger === "update" && fresh) {
          token.sessionVersion = fresh.sessionVersion;
          token.invalidated = false;
        }
      } else {
        token.invalidated = false;
      }

      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.orgId = token.orgId as string;
        if (token.picture) session.user.image = token.picture as string;
        if (token.invalidated) {
          (session as { invalidated?: boolean }).invalidated = true;
        }
      }
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

type SessionWithFlag = Session & { invalidated?: boolean };

/** Where invalidated sessions are sent so their cookie gets cleared (see requireUser). */
export const INVALIDATED_SESSION_PATH = "/api/session-invalidated";

/**
 * The raw NextAuth session, INCLUDING sessions whose sessionVersion no longer
 * matches the DB (`invalidated: true`). Only for code that must tell "no
 * session" apart from "dead session" — everything else should use auth(),
 * getCurrentUser() or requireUser().
 */
export async function authUnchecked(): Promise<SessionWithFlag | null> {
  return (await nextAuth.auth()) as SessionWithFlag | null;
}

/**
 * Fail-closed session accessor: returns null for a missing OR invalidated
 * session (SECH-86). Every `const session = await auth(); if (!session?.user)`
 * call site — API routes, Server Actions, permissions.ts — therefore rejects
 * a session killed by a password change / role change / admin reset without
 * each one having to remember to check `invalidated`.
 */
export async function auth(): Promise<Session | null> {
  const session = await authUnchecked();
  if (!session?.user || session.invalidated) return null;
  return session;
}

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

/**
 * Session guard for Server Component pages and layouts. No session → /login.
 * Invalidated session → INVALIDATED_SESSION_PATH, NOT /login: middleware (Edge,
 * no Prisma) can't see `invalidated`, so it still treats the stale JWT as
 * logged in and would bounce /login straight back to / — an infinite redirect
 * loop. The route handler there clears the cookie first.
 */
export async function requireUser(): Promise<Session> {
  const session = await authUnchecked();
  if (!session?.user) redirect("/login");
  if (session.invalidated) redirect(INVALIDATED_SESSION_PATH);
  return session;
}
