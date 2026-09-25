import { Resend } from "resend";
import { render } from "@react-email/components";
import { SecurityAlertEmail } from "@/emails/SecurityAlertEmail";
import { ALERT_FROM } from "./config";

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
