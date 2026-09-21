import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-86 regression: a session whose User.sessionVersion no longer matches
 * the DB (password change, role change, admin reset) must be rejected by
 * page routes, API routes, Server Actions and the permissions helpers — not
 * just by code paths that happened to call getCurrentUser().
 *
 * NextAuth itself is mocked, but the real jwt/session callbacks (captured from
 * the config passed to NextAuth) and the real auth()/requireUser()/
 * permissions.ts run on top of it.
 */

const h = vi.hoisted(() => ({
  nextAuthSession: vi.fn(),
  signOut: vi.fn(),
  config: { value: undefined as unknown as { callbacks: Record<string, (...a: unknown[]) => unknown> } },
  prisma: {
    user: { findUnique: vi.fn() },
    orgMember: { findFirst: vi.fn(), findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    groupPermission: { findMany: vi.fn() },
  },
}));

vi.mock("next-auth", () => ({
  default: (config: typeof h.config.value) => {
    h.config.value = config;
    return { handlers: {}, auth: h.nextAuthSession, signIn: vi.fn(), signOut: h.signOut };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  recordFailure: vi.fn(),
  getClientIp: vi.fn(),
  logAuthFailure: vi.fn(),
  LOGIN_RATE_LIMIT: { windowMs: 1 },
}));

import { auth, getCurrentUser, requireUser, INVALIDATED_SESSION_PATH } from "@/lib/auth";
import { requireProjectRole, requireOrgRole, requireAdmin } from "@/lib/permissions";
import { GET as sessionInvalidatedGET } from "@/app/api/session-invalidated/route";

const user = { id: "u1", role: "ADMIN", orgId: "org1", name: "A", email: "a@x.dev" };
const validSession = { user, expires: "2099-01-01" };
const deadSession = { user, expires: "2099-01-01", invalidated: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("jwt callback — sessionVersion comparison", () => {
  const jwt = (args: Record<string, unknown>) => h.config.value.callbacks.jwt(args) as Promise<Record<string, unknown>>;
  const sessionCb = (args: Record<string, unknown>) => h.config.value.callbacks.session(args) as { invalidated?: boolean };

  it("marks the token invalidated when the DB sessionVersion has advanced", async () => {
    h.prisma.user.findUnique.mockResolvedValue({ sessionVersion: 2 });
    const token = await jwt({ token: { id: "u1", sessionVersion: 1 } });
    expect(token.invalidated).toBe(true);
    expect(token.sessionVersion).toBe(1); // stays stale so the mismatch persists
  });

  it("keeps the token valid when versions match", async () => {
    h.prisma.user.findUnique.mockResolvedValue({ sessionVersion: 1 });
    expect((await jwt({ token: { id: "u1", sessionVersion: 1 } })).invalidated).toBe(false);
  });

  it("invalidates the token when the user no longer exists", async () => {
    h.prisma.user.findUnique.mockResolvedValue(null);
    expect((await jwt({ token: { id: "u1", sessionVersion: 1 } })).invalidated).toBe(true);
  });

  it("session.update() re-arms the token with the current DB version", async () => {
    h.prisma.orgMember.findFirst.mockResolvedValue({ orgId: "org1" });
    h.prisma.user.findUnique.mockResolvedValue({ sessionVersion: 2 });
    const token = await jwt({ token: { id: "u1", sessionVersion: 1 }, trigger: "update", session: {} });
    expect(token.invalidated).toBe(false);
    expect(token.sessionVersion).toBe(2);
  });

  it("the session callback surfaces invalidated only when set", () => {
    const base = { user: { id: "", role: "", orgId: "" }, expires: "" };
    expect(sessionCb({ session: { ...base }, token: { id: "u1", invalidated: true } }).invalidated).toBe(true);
    expect(sessionCb({ session: { ...base }, token: { id: "u1", invalidated: false } }).invalidated).toBeUndefined();
  });
});

describe("auth() / getCurrentUser() / requireUser() fail closed", () => {
  it("auth() returns the session when valid", async () => {
    h.nextAuthSession.mockResolvedValue(validSession);
    expect(await auth()).toEqual(validSession);
  });

  it("auth() returns null for an invalidated session (the SECH-86 gap)", async () => {
    h.nextAuthSession.mockResolvedValue(deadSession);
    expect(await auth()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("auth() returns null when there is no session", async () => {
    h.nextAuthSession.mockResolvedValue(null);
    expect(await auth()).toBeNull();
  });

  it("requireUser() returns a valid session", async () => {
    h.nextAuthSession.mockResolvedValue(validSession);
    await expect(requireUser()).resolves.toEqual(validSession);
  });

  it("requireUser() sends a missing session to /login", async () => {
    h.nextAuthSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireUser() sends an invalidated session to the cookie-clearing route, not /login (avoids the middleware redirect loop)", async () => {
    h.nextAuthSession.mockResolvedValue(deadSession);
    await expect(requireUser()).rejects.toThrow(`NEXT_REDIRECT:${INVALIDATED_SESSION_PATH}`);
  });
});

describe("permissions.ts helpers reject an invalidated session before touching the DB", () => {
  beforeEach(() => h.nextAuthSession.mockResolvedValue(deadSession));

  it("requireProjectRole", async () => {
    await expect(requireProjectRole("PL", () => true)).rejects.toThrow("Unauthorized");
    expect(h.prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("requireOrgRole (even for a platform ADMIN)", async () => {
    await expect(requireOrgRole("org1", () => true)).rejects.toThrow("Unauthorized");
  });

  it("requireAdmin", async () => {
    await expect(requireAdmin()).rejects.toThrow("Unauthorized");
  });

  it("still works for a valid session (control)", async () => {
    h.nextAuthSession.mockResolvedValue(validSession);
    await expect(requireAdmin()).resolves.toEqual({ userId: "u1" });
  });
});

describe("GET /api/session-invalidated", () => {
  it("clears the cookie and goes to /login for an invalidated session", async () => {
    h.nextAuthSession.mockResolvedValue(deadSession);
    await sessionInvalidatedGET();
    expect(h.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });

  it("clears the cookie for an absent session", async () => {
    h.nextAuthSession.mockResolvedValue(null);
    await sessionInvalidatedGET();
    expect(h.signOut).toHaveBeenCalled();
  });

  it("does NOT sign out a still-valid session", async () => {
    h.nextAuthSession.mockResolvedValue(validSession);
    const res = await sessionInvalidatedGET();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});

// ─── Static scans ────────────────────────────────────────────────────────────

const SRC = path.join(__dirname, "..");

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (match(e.name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

// pages that intentionally have no requireUser(), with the reason
const PAGE_ALLOWLIST: Record<string, string> = {
  "app/(dashboard)/projects/[projectKey]/page.tsx": "only redirects to /board, which is guarded",
};

describe("SECH-86: every dashboard page and layout is invalidation-aware", () => {
  const files = walk(path.join(SRC, "app", "(dashboard)"), (n) => n === "page.tsx" || n === "layout.tsx");

  it("found files to check", () => expect(files.length).toBeGreaterThan(10));

  for (const f of files) {
    it(`${rel(f)} calls requireUser()`, () => {
      if (PAGE_ALLOWLIST[rel(f)]) return;
      expect(fs.readFileSync(f, "utf8")).toMatch(/await\s+requireUser\(\)/);
    });
  }

  it("every allowlisted page still exists", () => {
    for (const p of Object.keys(PAGE_ALLOWLIST)) expect(fs.existsSync(path.join(SRC, p))).toBe(true);
  });
});

describe("SECH-86: the raw, invalidation-blind session accessor stays contained", () => {
  it("authUnchecked() is only used by src/lib/auth.ts and the session-invalidated route", () => {
    const users = walk(SRC, (n) => /\.(ts|tsx)$/.test(n))
      .filter((f) => !/__tests__|^integration\//.test(rel(f)) && fs.readFileSync(f, "utf8").includes("authUnchecked"))
      .map(rel)
      .sort();
    expect(users).toEqual(["app/api/session-invalidated/route.ts", "lib/auth.ts"]);
  });

  it("middleware stays Edge-safe: no Prisma, no full auth config", () => {
    const mw = fs.readFileSync(path.join(SRC, "middleware.ts"), "utf8");
    const importsPrisma = /^\s*import[^\n]*prisma/im;
    expect(mw).not.toMatch(importsPrisma);
    expect(mw).not.toMatch(/from\s+["']@\/lib\/auth["']/);
    const cfg = fs.readFileSync(path.join(SRC, "lib", "auth.config.ts"), "utf8");
    expect(cfg).not.toMatch(importsPrisma);
  });
});
