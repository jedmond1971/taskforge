/**
 * SECH-115 — shared secret corpus.
 *
 * One list of real secret SHAPES, used by the redaction unit tests. Import from tests
 * only; nothing in the app imports this file. The Prisma entry is a verbatim capture
 * from a production build (SECH-115 evidence), not a hand-written approximation — the
 * whole point is that the redactor is tested against what Prisma actually emits.
 */

export interface SecretPayload {
  name: string;
  /** A string that must never survive redaction intact. */
  payload: string;
  /** The substring that must be gone afterwards. */
  mustNotSurvive: string;
  note: string;
}

export const SECRET_PAYLOADS: SecretPayload[] = [
  {
    name: "jwt",
    payload:
      "session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    mustNotSurvive: "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    note: "NextAuth session JWT shape.",
  },
  {
    name: "bearer-header",
    payload: "Authorization: Bearer sk-live-abcdef0123456789abcdef0123456789",
    mustNotSurvive: "sk-live-abcdef0123456789abcdef0123456789",
    note: "Authorization header echoed by a failing HTTP client.",
  },
  {
    name: "basic-header",
    payload: "Authorization: Basic Y2xpZW50OnN1cGVyLXNlY3JldA==",
    mustNotSurvive: "Y2xpZW50OnN1cGVyLXNlY3JldA==",
    note: "OAuth confidential-client credentials.",
  },
  {
    name: "org-api-key",
    payload: "key=jfk_live_HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0",
    mustNotSurvive: "HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0",
    note: "Org API key. The jfk_live_ prefix may survive; the random tail may not.",
  },
  {
    name: "presigned-url",
    payload:
      "https://bucket.storageapi.dev/attachments/abc.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260924%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    mustNotSurvive: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    note: "Presigned S3 URL. Keep origin+path for debugging, drop the signing query.",
  },
  {
    name: "prisma-validation-error",
    payload: [
      "",
      "Invalid `prisma.docPage.create()` invocation:",
      "",
      "{",
      "  data: {",
      '    title: "probe",',
      '    content: "CONFIDENTIAL-DOC-BODY-abc123",',
      "    thisFieldDoesNotExist: true",
      "  }",
      "}",
      "",
      "Argument `docSpace` is missing.",
    ].join("\n"),
    mustNotSurvive: "CONFIDENTIAL-DOC-BODY-abc123",
    note: "Verbatim shape captured from a production build. Prisma embeds the whole data object.",
  },
];

/** Values that must SURVIVE redaction — over-redaction is the silent failure. */
export const MUST_SURVIVE: Array<{ name: string; value: string }> = [
  { name: "cuid", value: "cmo365psl000vdrd0p63lirlz" },
  { name: "prisma-error-code", value: "P2002" },
  { name: "issue-key", value: "SECH-115" },
  { name: "column-name", value: "userId_projectId" },
  { name: "ordinary-url", value: "https://www.jedforge.com/projects/PL/issues" },
];
