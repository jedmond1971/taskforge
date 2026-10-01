/**
 * Independent kill switches (SECH-118).
 *
 * Each switch is an env var that is ON unless set to an explicit "off" value, so an
 * unset variable never changes production behaviour. Flipping one in Railway is a
 * variable change + redeploy — no code change. Enforcement is in src/middleware.ts, which
 * answers 503 before any handler runs, so a disabled surface has no partial side effects
 * (no DB write, no S3 write, no token minted).
 *
 * Imports nothing on purpose: used from middleware, which runs on the Edge runtime.
 * AI_CHAT_ENABLED is a different shape (default OFF, Jamie-only) and stays in lib/ai.
 */

export type KillSwitch = "OAUTH_MCP_ENABLED" | "UPLOADS_ENABLED" | "EXTERNAL_API_ENABLED";

export const KILL_SWITCHES: readonly KillSwitch[] = [
  "OAUTH_MCP_ENABLED",
  "UPLOADS_ENABLED",
  "EXTERNAL_API_ENABLED",
];

// Deliberately lenient: in an incident, "flase" or "Off" leaving a surface open would be
// the worst possible failure, so every common spelling of "off" counts.
const OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

export function isSwitchEnabled(name: KillSwitch, env: Record<string, string | undefined> = process.env): boolean {
  const value = env[name];
  if (value === undefined) return true;
  return !OFF_VALUES.has(value.trim().toLowerCase());
}

type Rule = { switch: KillSwitch; path: RegExp; methods?: readonly string[] };

const WRITE = ["POST", "PUT", "PATCH"] as const;

/**
 * Surface -> switch. Reads of already-stored files (attachment/avatar/image downloads) and
 * DELETEs stay available when uploads are off: the switch stops new bytes entering storage,
 * it should not also break viewing existing content or cleaning up.
 */
export const KILL_SWITCH_RULES: readonly Rule[] = [
  // OAuth authorization server + MCP server (+ RFC 8414/9728 discovery metadata and consent screen).
  { switch: "OAUTH_MCP_ENABLED", path: /^\/api\/oauth(\/|$)/ },
  { switch: "OAUTH_MCP_ENABLED", path: /^\/api\/mcp(\/|$)/ },
  { switch: "OAUTH_MCP_ENABLED", path: /^\/\.well-known(\/|$)/ },
  { switch: "OAUTH_MCP_ENABLED", path: /^\/oauth\/authorize\/?$/ },

  // Org-scoped customer API.
  { switch: "EXTERNAL_API_ENABLED", path: /^\/api\/external(\/|$)/ },

  // Everything that can write bytes to object storage.
  { switch: "UPLOADS_ENABLED", path: /^\/api\/attachments\/(presign|upload|confirm)\/?$/, methods: WRITE },
  { switch: "UPLOADS_ENABLED", path: /^\/api\/avatar\/?$/, methods: WRITE },
  { switch: "UPLOADS_ENABLED", path: /^\/api\/editor-images\/?$/, methods: WRITE },
  { switch: "UPLOADS_ENABLED", path: /^\/api\/docs\/[^/]+\/pages\/[^/]+\/file\/?$/, methods: WRITE },
];

/** The switch governing this request, or null when it isn't behind one. */
export function killSwitchFor(pathname: string, method: string): KillSwitch | null {
  const m = method.toUpperCase();
  for (const rule of KILL_SWITCH_RULES) {
    if (rule.path.test(pathname) && (!rule.methods || rule.methods.includes(m))) return rule.switch;
  }
  return null;
}

/** The switch that is OFF for this request, or null when it may proceed. */
export function blockedBySwitch(
  pathname: string,
  method: string,
  env: Record<string, string | undefined> = process.env,
): KillSwitch | null {
  const name = killSwitchFor(pathname, method);
  return name && !isSwitchEnabled(name, env) ? name : null;
}
