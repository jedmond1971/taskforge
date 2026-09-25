import { getAlertConfig } from "./config";
import { ALERT_RULES, GLOBAL_CAP_PER_HOUR, RETRY_AFTER_FAILURE_MS, type AlertRule, type AlertableRecord } from "./rules";
import { observationsFor, isTripped, type Observation } from "./evaluate";
import * as store from "./store";
import { sendAlertEmail, type AlertMessage } from "./deliver";
import { alertingFailure } from "./log";

const CAP_RULE = "_cap";
const CAP_COOLDOWN_MS = 60 * 60 * 1000;

export interface DispatchContext {
  to: string;
  drill: boolean;
  requestId?: string;
  count?: number;
}
export interface DispatchResult {
  sent: boolean;
  reason?: "cap" | "cooldown" | "send_failed";
  error?: string;
}

function messageFor(rule: AlertRule, subject: string, ctx: DispatchContext, suppressed: number): AlertMessage {
  return {
    rule: rule.id,
    title: rule.title,
    severity: rule.severity,
    summary: rule.summary,
    subject,
    count: ctx.count,
    windowMinutes: rule.threshold ? Math.round(rule.threshold.windowMs / 60_000) : undefined,
    suppressed,
    triggeredAt: new Date().toISOString(),
    requestId: ctx.requestId,
    drill: ctx.drill,
  };
}

/** One "cap reached" email per hour, itself cooldown-claimed so a flood cannot loop it. */
async function sendCapNotice(to: string): Promise<void> {
  const claim = await store.claimSend(CAP_RULE, "global", CAP_COOLDOWN_MS);
  if (!claim.claimed) return;
  const result = await sendAlertEmail(
    {
      rule: "alert_cap",
      title: "Alert cap reached",
      severity: "warn",
      summary: `${GLOBAL_CAP_PER_HOUR} alert emails were sent in the last hour, so further alerts are suppressed until that drops. The underlying events are still in Deploy Logs.`,
      subject: "global",
      suppressed: claim.suppressed,
      triggeredAt: new Date().toISOString(),
      drill: false,
    },
    to
  );
  if (!result.success) {
    await store.backdateClaim(CAP_RULE, "global", CAP_COOLDOWN_MS, RETRY_AFTER_FAILURE_MS);
    alertingFailure("cap_notice_failed", result.error);
  }
}

/**
 * Cap check → cooldown claim → send → ledger. Shared by observe() and the drill (Task 9),
 * so the drill exercises the real path. Drill traffic skips the cap and the ledger so it can
 * neither be blocked by nor consume real alert budget.
 */
export async function dispatch(rule: AlertRule, subject: string, ctx: DispatchContext): Promise<DispatchResult> {
  if (!ctx.drill && (await store.sentInLastHour()) >= GLOBAL_CAP_PER_HOUR) {
    await sendCapNotice(ctx.to);
    return { sent: false, reason: "cap" };
  }

  let suppressed = 0;
  if (rule.cooldownMs > 0) {
    const claim = await store.claimSend(rule.id, subject, rule.cooldownMs);
    if (!claim.claimed) return { sent: false, reason: "cooldown" };
    suppressed = claim.suppressed;
  }

  const result = await sendAlertEmail(messageFor(rule, subject, ctx, suppressed), ctx.to);
  if (!result.success) {
    // Otherwise a failed send would silence this rule for its whole cooldown.
    if (rule.cooldownMs > 0) await store.backdateClaim(rule.id, subject, rule.cooldownMs, RETRY_AFTER_FAILURE_MS);
    alertingFailure("send_failed", result.error);
    return { sent: false, reason: "send_failed", error: result.error };
  }
  if (!ctx.drill) await store.recordSent();
  return { sent: true };
}

async function handle(obs: Observation, record: AlertableRecord, to: string): Promise<void> {
  const { rule, subject, detail } = obs;
  let count: number | undefined;
  if (rule.threshold) {
    await store.recordObservation(rule.id, subject, detail);
    count = await store.countInWindow(rule.id, subject, rule.threshold.windowMs, !!rule.distinctBy);
    if (!isTripped(rule, count)) return;
  }
  await dispatch(rule, subject, { to, drill: false, requestId: record.requestId, count });
}

/**
 * Entry point from emit(). NEVER rejects: an alerting failure must not surface anywhere a
 * request can see it. Immediate rules write no observation row — they go straight to the
 * cooldown claim.
 */
export async function observe(record: AlertableRecord): Promise<void> {
  try {
    const cfg = getAlertConfig();
    if (!cfg.ready || !cfg.to) {
      // Enabled-but-unconfigured must not look like a quiet week.
      if (cfg.enabled) alertingFailure("misconfigured", `missing ${cfg.missing.join(", ")}`, { once: true });
      return;
    }
    for (const obs of observationsFor(record)) await handle(obs, record, cfg.to);
  } catch (err) {
    alertingFailure("observe_failed", err);
  }
}

export { ALERT_RULES };
