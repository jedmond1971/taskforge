/**
 * Alert rules (SECH-117). Data only, and import-free: security-events.ts reads
 * ALERT_SOURCE_TYPES on every emit to decide whether alerting needs to be loaded at all.
 *
 * Thresholds live here, in code, on purpose: a Railway env change restarts the service
 * anyway, so an env override saves almost nothing and loses test coverage.
 */

export type AlertRuleId =
  | "login_spray"
  | "refresh_reuse"
  | "revoked_key_used"
  | "admin_role_granted"
  | "authz_probe"
  | "error_spike";

/** The subset of a security-event record alerting reads (post-redaction). */
export interface AlertableRecord {
  type: string;
  ts: string;
  requestId?: string;
  userId?: string;
  targetUserId?: string;
  orgId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

export interface AlertRule {
  id: AlertRuleId;
  title: string;
  severity: "warn" | "critical";
  /** Event types this rule listens to. Must all exist in the SECH-114 catalog. */
  sources: readonly string[];
  /** What the rule groups by. Undefined drops the observation rather than bucketing it. */
  subject: (r: AlertableRecord) => string | undefined;
  /** When set, the threshold counts DISTINCT values of this, not events. */
  distinctBy?: (r: AlertableRecord) => string | undefined;
  /** Absent = fires on every occurrence. */
  threshold?: { count: number; windowMs: number };
  /** 0 = no cooldown (every occurrence emails). */
  cooldownMs: number;
  /** One line for the email body. */
  summary: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export const ALERT_RULES: readonly AlertRule[] = [
  {
    id: "login_spray",
    title: "Login attempts across many accounts from one IP",
    severity: "warn",
    sources: ["auth.login_failed", "auth.login_throttled"],
    // "unknown" means the client IP could not be derived; grouping on it would pool unrelated
    // failures into one subject.
    subject: (r) => (r.ip && r.ip !== "unknown" ? r.ip : undefined),
    distinctBy: (r) => str(r.meta?.emailAttempted),
    threshold: { count: 10, windowMs: 10 * MINUTE },
    cooldownMs: HOUR,
    summary:
      "One IP failed to log in to many different accounts in a short window — credential stuffing looks like this because it tries one password per account and never hits the per-account throttle.",
  },
  {
    id: "refresh_reuse",
    title: "Refresh-token reuse detected",
    severity: "critical",
    sources: ["oauth.refresh_reuse_detected"],
    subject: (r) => str(r.userId),
    cooldownMs: HOUR,
    summary:
      "A revoked OAuth refresh token was presented again. Either a token leaked or a token family was cloned; the whole family has been revoked.",
  },
  {
    id: "revoked_key_used",
    title: "Revoked API key used",
    severity: "critical",
    sources: ["apikey.used_after_revoke"],
    subject: (r) => str(r.meta?.apiKeyId),
    cooldownMs: HOUR,
    summary:
      "A revoked org API key is still being presented. The holder has not noticed, or is not the person it was revoked from.",
  },
  {
    id: "admin_role_granted",
    title: "Platform ADMIN role granted",
    severity: "critical",
    sources: ["admin.role_granted"],
    subject: (r) => str(r.targetUserId),
    cooldownMs: 0,
    summary: "A user was given the platform ADMIN role, which can read and change every tenant. If this was not you, act now.",
  },
  {
    id: "authz_probe",
    title: "Repeated cross-tenant authorization denials",
    severity: "warn",
    sources: [
      "authz.denied_not_member",
      "authz.denied_private_project",
      "authz.denied_not_org_member",
      "authz.denied_admin",
    ],
    subject: (r) => str(r.userId),
    threshold: { count: 10, windowMs: 10 * MINUTE },
    cooldownMs: HOUR,
    summary:
      "One signed-in user has been refused many times for projects or orgs they do not belong to, or for admin pages — a tenant-boundary probe.",
  },
  {
    id: "error_spike",
    title: "Application error spike",
    severity: "warn",
    sources: ["app.error", "prisma.error"],
    subject: () => "global",
    threshold: { count: 20, windowMs: 5 * MINUTE },
    cooldownMs: 30 * MINUTE,
    summary: "The application logged many errors in a short window. Check Deploy Logs for the app.error / prisma.error events.",
  },
];

export const ALERT_SOURCE_TYPES: ReadonlySet<string> = new Set(ALERT_RULES.flatMap((r) => Array.from(r.sources)));

/** Soft global flood guard — two instances can overshoot by one. */
export const GLOBAL_CAP_PER_HOUR = 10;

/** After a failed send, a matching event may retry once this much of the cooldown has passed. */
export const RETRY_AFTER_FAILURE_MS = 5 * MINUTE;

/**
 * Bound on concurrent observe() calls (review C1). During an outage or an error storm every
 * event would otherwise start its own chain of DB work and, if Resend is slow, hold it for the
 * whole retry schedule. Excess observations are dropped with one "[alerting] overloaded" line.
 */
export const MAX_IN_FLIGHT = 20;

/** Delays before each inline retry of a failed send (review I3): the attempt, then two retries. */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];
