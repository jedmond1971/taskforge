import { Resend } from "resend";
import { render } from "@react-email/components";
import { SecurityAlertEmail } from "@/emails/SecurityAlertEmail";
import { ALERT_FROM } from "./config";
import { SEND_RETRY_DELAYS_MS } from "./rules";

export interface AlertMessage {
  rule: string;
  title: string;
  severity: "warn" | "critical";
  summary: string;
  subject: string;
  count?: number;
  windowMinutes?: number;
  suppressed: number;
  triggeredAt: string;
  requestId?: string;
  drill: boolean;
}

export function alertEmailSubject(msg: AlertMessage): string {
  return `${msg.drill ? "[DRILL] " : ""}[JedForge ${msg.severity.toUpperCase()}] ${msg.title}`;
}

/**
 * Never throws: alerting must not be the reason anything fails. The Resend client is built
 * inside the function (module-level construction breaks CI's static page-data step) and the
 * template is rendered to html first because `react:` fails at runtime — see email.md.
 */
export async function sendAlertEmail(
  msg: AlertMessage,
  to: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = await render(SecurityAlertEmail(msg));
    const result = await resend.emails.send({ from: ALERT_FROM, to, subject: alertEmailSubject(msg), html });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

let retryDelaysMs: readonly number[] = SEND_RETRY_DELAYS_MS;

/** Test seam: the real delays are seconds, which no test should wait for. */
export function setSendRetryDelaysForTest(delays: readonly number[]): void {
  retryDelaysMs = delays;
}

/**
 * sendAlertEmail with inline retries (review I3). A one-off critical alert — an admin grant has
 * no cooldown row to backdate, and a reused refresh token's family is already revoked so the
 * event will not recur — is otherwise lost to a single transient Resend failure. Returns the
 * LAST result; sleeps between attempts. Runs inside a detached observe(), so waiting is free.
 */
export async function sendAlertEmailWithRetry(
  msg: AlertMessage,
  to: string
): Promise<{ success: boolean; error?: string }> {
  let result = await sendAlertEmail(msg, to);
  for (const delay of retryDelaysMs) {
    if (result.success) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await sendAlertEmail(msg, to);
  }
  return result;
}
