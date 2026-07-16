import crypto from "crypto";

export function generateOAuthClientSecret(): string {
  return `mcp_secret_${crypto.randomBytes(24).toString("base64url")}`;
}

export function generateAuthorizationCode(): string {
  return `mcp_ac_${crypto.randomBytes(32).toString("base64url")}`;
}

export function generateAccessToken(): string {
  return `mcp_at_${crypto.randomBytes(32).toString("base64url")}`;
}

export function generateRefreshToken(): string {
  return `mcp_rt_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashOAuthSecret(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

// RFC 7636 S256: BASE64URL(SHA256(code_verifier)) === code_challenge
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(crypto.createHash("sha256").update(codeVerifier).digest("base64url"));
  const expected = Buffer.from(codeChallenge);
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}
