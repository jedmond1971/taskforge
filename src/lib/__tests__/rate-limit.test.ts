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

import { checkRateLimit, recordFailure, getClientIp } from "@/lib/rate-limit";

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
  it("reads the first IP from x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("203.0.113.5");
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
