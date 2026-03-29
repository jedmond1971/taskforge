import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard") || nextUrl.pathname === "/";
      const isOnAuth = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false;
      } else if (isOnAuth) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      return true;
    },
  },
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
        };
      },
    }),
  ],
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
