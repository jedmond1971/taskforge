import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRateLimit } = vi.hoisted(() => {
  const mockRateLimit = {
    checkRateLimit: vi.fn(),
    recordFailure: vi.fn(),
    getClientIp: vi.fn(),
    logAuthFailure: vi.fn(),
    V1_API_RATE_LIMIT: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  };
  return { mockRateLimit };
});

vi.mock("@/lib/rate-limit", () => mockRateLimit);

import { requireV1ApiKey } from "@/lib/v1-auth";

const REAL_KEY = "correct-secret-key-value";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/v1/issues", { headers });
}

describe("requireV1ApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.V1_API_KEY = REAL_KEY;
    mockRateLimit.getClientIp.mockReturnValue("203.0.113.5");
    mockRateLimit.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it("returns null (authorized) for a matching key when not rate-limited", async () => {
    const result = await requireV1ApiKey(makeRequest({ "X-Internal-Api-Key": REAL_KEY }));

    expect(result).toBeNull();
    expect(mockRateLimit.recordFailure).not.toHaveBeenCalled();
  });

  it("returns 401 and records a failure when the key header is missing", async () => {
    const result = await requireV1ApiKey(makeRequest());

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    expect(mockRateLimit.recordFailure).toHaveBeenCalledWith("v1api:203.0.113.5", expect.any(Number));
  });

  it("returns 401 and records a failure when the key doesn't match", async () => {
    const result = await requireV1ApiKey(makeRequest({ "X-Internal-Api-Key": "wrong-key" }));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    expect(mockRateLimit.recordFailure).toHaveBeenCalledWith("v1api:203.0.113.5", expect.any(Number));
    expect(mockRateLimit.logAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "v1-api", reason: "invalid_key" })
    );
  });

  it("returns 429 with Retry-After when rate-limited, without checking the key", async () => {
    mockRateLimit.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });

    const result = await requireV1ApiKey(makeRequest({ "X-Internal-Api-Key": REAL_KEY }));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    expect(result!.headers.get("Retry-After")).toBe("42");
    expect(mockRateLimit.recordFailure).not.toHaveBeenCalled();
  });

  it("returns 500 when V1_API_KEY is not configured", async () => {
    delete process.env.V1_API_KEY;

    const result = await requireV1ApiKey(makeRequest({ "X-Internal-Api-Key": REAL_KEY }));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
