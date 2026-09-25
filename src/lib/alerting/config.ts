/**
 * Alerting configuration (SECH-117).
 *
 * Deliberately import-free: security-events.ts loads this statically on every emit, and it
 * must not drag Prisma or Resend into that path.
 */
export const ALERT_FROM = "JedForge Alerts <alerts@jedforge.com>";

/** Plain string map: Next augments NodeJS.ProcessEnv to require NODE_ENV, which tests should not have to supply. */
export type AlertEnv = Record<string, string | undefined>;

export interface AlertConfig {
  /** ALERTING_ENABLED is exactly "true". Unset means off, which is the merge-dormant default. */
  enabled: boolean;
  /** Enabled AND everything needed to send is present. */
  ready: boolean;
  to: string | undefined;
  /** Names of missing variables. Non-empty + enabled is a misconfiguration, not silence. */
  missing: string[];
}

export function alertingEnabled(env: AlertEnv = process.env): boolean {
  return env.ALERTING_ENABLED === "true";
}

export function getAlertConfig(env: AlertEnv = process.env): AlertConfig {
  const enabled = alertingEnabled(env);
  const to = env.ALERT_EMAIL_TO?.trim() || undefined;
  const missing: string[] = [];
  if (!to) missing.push("ALERT_EMAIL_TO");
  if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  return { enabled, ready: enabled && missing.length === 0, to, missing };
}
