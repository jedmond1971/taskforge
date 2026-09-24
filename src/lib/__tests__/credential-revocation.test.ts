import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockSecurityEvents } = vi.hoisted(() => ({
  mockPrisma: { apiKey: { updateMany: vi.fn() } },
  mockSecurityEvents: { securityEvent: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/security-events", () => mockSecurityEvents);
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { revokeApiKeysForUser } from "@/lib/credential-revocation";

beforeEach(() => vi.clearAllMocks());

describe("revokeApiKeysForUser events (SECH-114)", () => {
  // Review fix 6: emitting unconditionally means an offboarding of 40 members writes 40
  // "keys revoked" events when the real number may be zero — a log that asserts something
  // that did not happen is worse than no log.
  it("emits nothing when no keys were actually revoked", async () => {
    mockPrisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

    await revokeApiKeysForUser("victim1", "o1");

    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  // Review fix 1: here userId is the account acted UPON, not the actor. It must land in
  // targetUserId, or "what did this account do?" returns keys someone else destroyed.
  it("reports the revoked count and names the subject, not an actor", async () => {
    mockPrisma.apiKey.updateMany.mockResolvedValue({ count: 3 });

    await revokeApiKeysForUser("victim1", "o1");

    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "apikey.revoked",
      expect.objectContaining({
        targetUserId: "victim1",
        orgId: "o1",
        meta: expect.objectContaining({ count: 3, reason: "credential_revocation" }),
      })
    );
    const fields = mockSecurityEvents.securityEvent.mock.calls[0][1];
    expect(fields).not.toHaveProperty("userId");
  });
});
