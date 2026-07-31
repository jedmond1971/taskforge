/**
 * AI Chat is exclusive to Jamie's own use of JedForge — it must never be
 * enabled for a buyer or other entity if the product is ever sold or
 * transferred. Gated behind an env var that's set on Jamie's own
 * deployment only; a plain copy of this codebase ships with it off.
 */
export function isAiChatEnabled(): boolean {
  return process.env.AI_CHAT_ENABLED === "true";
}
