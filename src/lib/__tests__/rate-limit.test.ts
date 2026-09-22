import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    rateLimitAttempt: {
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return { mockPrisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  checkRateLimit,
  recordFailure,
  getClientIp,
  checkLoginRateLimit,
  recordLoginFailure,
  LOGIN_RATE_LIMIT,
  ACCOUNT_LOGIN_RATE_LIMIT,
} from "@/lib/rate-limit";

const CONFIG = { maxAttempts: 5, windowMs: 15 * 60 * 1000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the attempt when the failure count is under the threshold", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(4);

    const result = await checkRateLimit("login:1.2.3.4:user@example.com", CONFIG);

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(mockPrisma.rateLimitAttempt.findFirst).not.toHaveBeenCalled();
  });

  it("blocks the attempt with a positive retryAfterSeconds once at the threshold", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(5);
    const oldestCreatedAt = new Date(Date.now() - 60 * 1000); // 1 minute ago
    mockPrisma.rateLimitAttempt.findFirst.mockResolvedValue({ createdAt: oldestCreatedAt });

    const result = await checkRateLimit("login:1.2.3.4:user@example.com", CONFIG);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    // window is 15 minutes, oldest failure was 1 minute ago -> ~14 minutes left
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(CONFIG.windowMs / 1000);
  });

  it("blocks the attempt even past the threshold (e.g. a burst of failures)", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(9);
    mockPrisma.rateLimitAttempt.findFirst.mockResolvedValue({ createdAt: new Date() });

    const result = await checkRateLimit("v1api:5.6.7.8", CONFIG);

    expect(result.allowed).toBe(false);
  });

  it("allows again once failures have aged out of the window (count back to 0)", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(0);

    const result = await checkRateLimit("login:1.2.3.4:user@example.com", CONFIG);

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("scopes the count query to the given key and the window start", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(0);

    await checkRateLimit("login:9.9.9.9:someone@example.com", CONFIG);

    const whereArg = mockPrisma.rateLimitAttempt.count.mock.calls[0][0].where;
    expect(whereArg.key).toBe("login:9.9.9.9:someone@example.com");
    expect(whereArg.createdAt.gte).toBeInstanceOf(Date);
  });
});

describe("recordFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a row for the key", async () => {
    await recordFailure("login:1.2.3.4:user@example.com", CONFIG.windowMs);

    expect(mockPrisma.rateLimitAttempt.create).toHaveBeenCalledWith({
      data: { key: "login:1.2.3.4:user@example.com" },
    });
  });

  it("prunes rows for the key older than the window", async () => {
    await recordFailure("login:1.2.3.4:user@example.com", CONFIG.windowMs);

    const whereArg = mockPrisma.rateLimitAttempt.deleteMany.mock.calls[0][0].where;
    expect(whereArg.key).toBe("login:1.2.3.4:user@example.com");
    expect(whereArg.createdAt.lt).toBeInstanceOf(Date);
  });
});

describe("getClientIp", () => {
  it("reads the single IP the edge sets in x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });

    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  // SECH-108: the shape Railway's edge actually sends — real client first, then an internal
  // proxy hop that differs per request. The key must stay stable across those hops (keying on
  // the rightmost hop gave every request a fresh bucket in production).
  it("keys on the client IP, not the rotating internal proxy hop", () => {
    const client = "198.51.100.20";
    const keys = ["100.64.0.7", "100.64.12.201", "100.81.3.9"].map((hop) =>
      getClientIp(
        new Request("https://example.com", {
          headers: { "x-forwarded-for": `${client}, ${hop}` },
        })
      )
    );

    expect(new Set(keys)).toEqual(new Set([client]));
  });

  it("trims whitespace around the client hop", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "  198.51.100.20 , 100.64.0.7" },
    });

    expect(getClientIp(request)).toBe("198.51.100.20");
  });

  it("prefers x-forwarded-for over a client-supplied x-real-ip", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "198.51.100.20", "x-real-ip": "6.6.6.6" },
    });

    expect(getClientIp(request)).toBe("198.51.100.20");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "198.51.100.7" },
    });

    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("falls back to \"unknown\" when neither header is present", () => {
    const request = new Request("https://example.com");

    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("login rate limit (ip+email and account-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.rateLimitAttempt.findFirst.mockResolvedValue({ createdAt: new Date() });
  });

  function failuresByKey(counts: Record<string, number>) {
    mockPrisma.rateLimitAttempt.count.mockImplementation(
      async ({ where }: { where: { key: string } }) => counts[where.key] ?? 0
    );
  }

  it("allows when both buckets are under their limits", async () => {
    failuresByKey({});
    expect((await checkLoginRateLimit("1.2.3.4", "a@x.dev")).allowed).toBe(true);
  });

  it("blocks on the ip+email bucket", async () => {
    failuresByKey({ "login:1.2.3.4:a@x.dev": LOGIN_RATE_LIMIT.maxAttempts });
    expect((await checkLoginRateLimit("1.2.3.4", "a@x.dev")).allowed).toBe(false);
  });

  // SECH-108: a distributed attacker gets a fresh ip+email bucket per IP, so the
  // account-only bucket must still stop them.
  it("blocks a fresh IP once the account-only bucket is full", async () => {
    failuresByKey({ "login-account:a@x.dev": ACCOUNT_LOGIN_RATE_LIMIT.maxAttempts });
    const result = await checkLoginRateLimit("203.0.113.250", "a@x.dev");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not let one account's failures block another account", async () => {
    failuresByKey({ "login-account:a@x.dev": ACCOUNT_LOGIN_RATE_LIMIT.maxAttempts });
    expect((await checkLoginRateLimit("1.2.3.4", "b@x.dev")).allowed).toBe(true);
  });

  it("records a failure against both buckets", async () => {
    await recordLoginFailure("1.2.3.4", "a@x.dev");
    const keys = mockPrisma.rateLimitAttempt.create.mock.calls.map((c) => c[0].data.key);
    expect(keys).toEqual(["login:1.2.3.4:a@x.dev", "login-account:a@x.dev"]);
  });
});
