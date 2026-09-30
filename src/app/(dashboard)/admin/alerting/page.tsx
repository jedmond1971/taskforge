import { requireUser } from "@/lib/auth";
import { getAlertConfig } from "@/lib/alerting/config";
import { AlertDrillClient } from "./AlertDrillClient";

export default async function AdminAlertingPage() {
  await requireUser();
  const cfg = getAlertConfig();
  // Booleans only: the recipient address and API key never reach the client.
  return (
    <AlertDrillClient
      enabled={cfg.enabled}
      hasRecipient={!cfg.missing.includes("ALERT_EMAIL_TO")}
      hasResendKey={!cfg.missing.includes("RESEND_API_KEY")}
    />
  );
}
