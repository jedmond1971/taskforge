import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!passwordMatch) return null;

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

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) return null;
  if ((session as { invalidated?: boolean }).invalidated) return null;
  return session.user;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
