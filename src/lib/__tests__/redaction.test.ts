import { describe, it, expect } from "vitest";
import { redactString, REDACTED } from "@/lib/redaction";
import { SECRET_PAYLOADS, MUST_SURVIVE } from "@/test-support/secret-payloads";

describe("redactString", () => {
  it.each(SECRET_PAYLOADS.filter((p) => p.name !== "prisma-validation-error"))(
    "scrubs $name",
    ({ payload, mustNotSurvive }) => {
      expect(redactString(payload)).not.toContain(mustNotSurvive);
    }
  );

  it("keeps the API key prefix so a key is still identifiable", () => {
    const out = redactString("key=jfk_live_HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0");
    expect(out).toContain("jfk_live_");
    expect(out).not.toContain("HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0");
  });

  it("keeps origin and path of a presigned URL, drops the signing query", () => {
    const out = redactString(SECRET_PAYLOADS.find((p) => p.name === "presigned-url")!.payload);
    expect(out).toContain("https://bucket.storageapi.dev/attachments/abc.png");
    expect(out).not.toContain("X-Amz-Signature");
  });

  // Review Focus 1: over-redaction is the failure nobody notices until an incident.
  it.each(MUST_SURVIVE)("leaves $name untouched", ({ value }) => {
    expect(redactString(`context ${value} more`)).toContain(value);
  });

  it("redacts a literal env secret value wherever it appears", () => {
    process.env.TEST_ONLY_SECRET = "s3cret-value-long-enough-to-match";
    try {
      const out = redactString("connect failed for s3cret-value-long-enough-to-match", [
        "TEST_ONLY_SECRET",
      ]);
      expect(out).not.toContain("s3cret-value-long-enough-to-match");
      expect(out).toContain(REDACTED);
    } finally {
      delete process.env.TEST_ONLY_SECRET;
    }
  });

  // Review Focus 5: a short or empty variable must not become a match-everything rule.
  it.each([
    ["empty", ""],
    ["too short", "abc"],
  ])("ignores an env secret that is %s", (_label, value) => {
    process.env.TEST_ONLY_SECRET = value;
    try {
      const out = redactString("a perfectly ordinary log line about abc", ["TEST_ONLY_SECRET"]);
      expect(out).toBe("a perfectly ordinary log line about abc");
    } finally {
      delete process.env.TEST_ONLY_SECRET;
    }
  });
});
