import crypto from "crypto";

export function generateApiKey(): string {
  // 24 bytes → 32 url-safe base64 chars (no padding)
  const random = crypto.randomBytes(24).toString("base64url");
  return `jfk_live_${random}`;
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}
