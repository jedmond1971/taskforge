import { randomRequestId } from "./request-id";
import { redact, MAX_STRING_LENGTH } from "./redaction";

/**
 * Structured security events (SECH-114).
 *
 * One shape, one catalog, one emit seam. Severity is a property of the event TYPE,
 * not something a call site passes, so the same event can never be reported at two
 * different severities from two places.
 *
 * SECH-115 inserts redaction inside emit(); SECH-117 adds a sink there. Neither has
 * to touch a call site.
 */

export type SecuritySeverity = "info" | "warn" | "critical";

export type SecurityEventType =
  // Phase 1 — converted from pre-existing ad-hoc logging
  | "auth.login_failed"
  | "auth.login_throttled"
  | "auth.v1_key_invalid"
  | "auth.v1_throttled"
  | "ratelimit.monitor_would_block"
  | "csp.violation"
  // Phase 2 — net-new emissions
  | "authz.denied_not_member"
  | "authz.denied_private_project"
  | "authz.denied_not_org_member"
  | "authz.denied_role"
  | "authz.denied_admin"
  | "oauth.token_failed"
  | "oauth.refresh_reuse_detected"
  | "apikey.created"
  | "apikey.revoked"
  | "apikey.used_after_revoke"
  | "session.invalidated"
  | "upload.rejected"
  | "admin.action";

export const SECURITY_EVENT_SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  "auth.login_failed": "warn",
  "auth.login_throttled": "warn",
  "auth.v1_key_invalid": "warn",
  "auth.v1_throttled": "warn",
  "ratelimit.monitor_would_block": "info",
  "csp.violation": "info",
  // Tenancy-boundary denials are near-zero volume in normal use and are the highest
  // signal an attacker is probing across orgs, so they are warn and always emitted.
  "authz.denied_not_member": "warn",
  "authz.denied_private_project": "warn",
  "authz.denied_not_org_member": "warn",
  "authz.denied_role": "info",
  "authz.denied_admin": "warn",
  "oauth.token_failed": "warn",
  // A replayed refresh token means a token leaked or a family was cloned.
  "oauth.refresh_reuse_detected": "critical",
  "apikey.created": "info",
  "apikey.revoked": "info",
  // A revoked key still being presented means the holder has not noticed, or is not
  // the person we revoked it from.
  "apikey.used_after_revoke": "critical",
  "session.invalidated": "info",
  "upload.rejected": "warn",
  "admin.action": "info",
};

export const SECURITY_EVENT_TYPES = Object.keys(SECURITY_EVENT_SEVERITY) as SecurityEventType[];

export type SecurityEventFields = {
  requestId?: string;
  /** The account that PERFORMED the action. Always the actor, never the subject. */
  userId?: string;
  /** The account the action was performed UPON, when that differs from the actor. */
  targetUserId?: string;
  orgId?: string;
  ip?: string;
  /** Caller detail. Nested, never spread — a caller key must not overwrite `type`. */
  meta?: Record<string, unknown>;
};

export function securityEvent(type: SecurityEventType, fields: SecurityEventFields = {}): void {
  emit({
    evt: "security",
    ts: new Date().toISOString(),
    type,
    severity: SECURITY_EVENT_SEVERITY[type],
    // Middleware does not run on /api/auth, where login failures originate, so an
    // event may legitimately arrive with no request context. Every event still gets
    // a correlation ID.
    requestId: fields.requestId ?? randomRequestId(),
    ...(fields.userId ? { userId: fields.userId } : {}),
    ...(fields.targetUserId ? { targetUserId: fields.targetUserId } : {}),
    ...(fields.orgId ? { orgId: fields.orgId } : {}),
    ...(fields.ip ? { ip: fields.ip } : {}),
    // SECH-115: only caller-supplied meta is redacted. The reserved fields above are set
    // by the emitter from typed arguments, so redacting them would mangle `type` for no gain.
    ...(fields.meta
      ? { meta: redact(fields.meta, { maxStringLength: MAX_STRING_LENGTH }) as Record<string, unknown> }
      : {}),
  });
}

/**
 * The single write point. JSON.stringify throws on circular structures and BigInt,
 * and a caller passing a Prisma object into meta is a realistic mistake — an
 * exception here would turn a failed login into a 500, so it degrades instead.
 */
function emit(record: Record<string, unknown>): void {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      evt: record.evt,
      ts: record.ts,
      type: record.type,
      severity: record.severity,
      requestId: record.requestId,
      meta: { serializationFailed: true },
    });
  }
  console.warn(line);
}
