import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSecurityEvents } = vi.hoisted(() => ({ mockSecurityEvents: { securityEvent: vi.fn() } }));
vi.mock("@/lib/security-events", () => mockSecurityEvents);
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "203.0.113.9" }));

import { POST } from "@/app/api/csp-report/route";

beforeEach(() => vi.clearAllMocks());

function report(documentUri: string) {
  return new Request("https://example.com/api/csp-report", {
    method: "POST",
    body: JSON.stringify({ "csp-report": { "document-uri": documentUri, "blocked-uri": "inline" } }),
  });
}

const meta = () => mockSecurityEvents.securityEvent.mock.calls[0][1].meta;

describe("csp-report scrubbing (SECH-114 / SECH-84)", () => {
  // Review fix 5: scrub() stripped only the query string, but an invite token lives in the
  // PATH (/invite/<token>). A CSP violation on an invite page wrote a live, unused invite
  // token to the log stream — which SECH-116/117 are meant to ship off-platform.
  it("redacts an invite token carried in the path", async () => {
    await POST(report("https://www.jedforge.com/invite/abc123secrettoken"));

    const document = meta().document as string;
    expect(document).not.toContain("abc123secrettoken");
    expect(document).toContain("/invite/");
  });

  it("still strips the query string", async () => {
    await POST(report("https://www.jedforge.com/oauth/authorize?state=s3cr3t&code=abc"));

    const document = meta().document as string;
    expect(document).not.toContain("s3cr3t");
    expect(document).toBe("https://www.jedforge.com/oauth/authorize");
  });

  it("leaves an ordinary path intact", async () => {
    await POST(report("https://www.jedforge.com/projects/PL/issues"));
    expect(meta().document).toBe("https://www.jedforge.com/projects/PL/issues");
  });
});
