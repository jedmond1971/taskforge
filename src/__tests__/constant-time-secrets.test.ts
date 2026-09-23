import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * SH-021 / SECH-109: wherever a caller-supplied secret is compared against a stored one in
 * application code, the comparison has to be constant-time. A `===` on the secret (or on its
 * digest) returns as soon as it finds a differing byte, which is a byte-at-a-time oracle.
 *
 * Lookups that hand the digest to the database (`findUnique({ where: { hashedToken } })`) are
 * not listed here — there is no comparison in our code to get wrong.
 */
const COMPARISON_SITES = [
  "src/lib/v1-auth.ts", // internal v1 shared secret
  "src/app/api/oauth/token/route.ts", // OAuth confidential-client secret
];

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("constant-time secret comparison", () => {
  it.each(COMPARISON_SITES)("%s uses timingSafeEqual", (rel) => {
    expect(read(rel)).toMatch(/timingSafeEqual\s*\(/);
  });

  it.each(COMPARISON_SITES)("%s never compares a secret or its digest with ==/===", (rel) => {
    const offending = read(rel)
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /(hashOAuthSecret|hashApiKey|SecretHash|hashedKey|hashedToken|incomingKey|apiKey)\b[^\n]*[!=]==/.test(line))
      .filter(([, line]) => !line.trimStart().startsWith("//"));

    expect(offending.map(([n, l]) => `${rel}:${n}: ${l.trim()}`)).toEqual([]);
  });
});
