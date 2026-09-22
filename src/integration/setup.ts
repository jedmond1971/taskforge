import { vi, beforeEach } from "vitest";

// Safety: these tests create and delete rows. Never let them near a shared/prod database.
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  throw new Error(
    `Refusing to run integration tests: DATABASE_URL host is "${host || "(unset)"}", not localhost.`
  );
}

// The session is the only thing faked about auth: each test picks who is "logged in".
// Everything downstream (permissions.ts, actions, route handlers, Prisma) is real.
vi.mock("@/lib/auth", async () => {
  const s = await import("./session");
  return {
    auth: async () => s.currentSession(),
    authUnchecked: async () => s.currentSession(),
    getCurrentUser: async () => s.currentSession()?.user ?? null,
    requireAuth: async () => {
      const user = s.currentSession()?.user;
      if (!user) throw new Error("Unauthorized");
      return user;
    },
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    INVALIDATED_SESSION_PATH: "/api/session-invalidated",
  };
});

// Server Actions read the client IP via next/headers (SECH-107 rate limits).
vi.mock("next/headers", async () => {
  const s = await import("./session");
  return {
    headers: async () => new Headers({ "x-forwarded-for": s.currentClientIp() }),
    cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
  };
});

// Rate-limit rows live 15-60 min; clear them so reruns and earlier tests can't
// throttle later ones. Safe because files run sequentially (fileParallelism: false).
beforeEach(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.rateLimitAttempt.deleteMany();
  const s = await import("./session");
  s.setClientIp("203.0.113.200");
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/s3", () => ({
  getPresignedUploadUrl: async (key: string) => `https://s3.test/upload/${key}`,
  getPresignedDownloadUrl: async (key: string) => `https://s3.test/download/${key}`,
  putObject: async () => {},
  deleteObject: async () => {},
  deleteObjectsWithPrefix: async () => {},
  deleteObjects: async () => {},
  headObjectSize: async () => null,
  listObjects: async () => [],
  getObjectBuffer: async () => Buffer.from(""),
}));
