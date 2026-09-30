"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminSendAlertDrill } from "../actions";
import type { DrillResult } from "@/lib/alerting";

const card = "bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-success" : "text-danger"}>{ok ? "✓" : "✗"}</span>
      <span className="text-foreground">{label}</span>
    </li>
  );
}

export function AlertDrillClient({
  enabled,
  hasRecipient,
  hasResendKey,
}: {
  enabled: boolean;
  hasRecipient: boolean;
  hasResendKey: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DrillResult | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const res = await adminSendAlertDrill();
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        setResult(res.result);
        if (!res.result.configured) toast.error("Alerting is not configured — nothing was sent");
        else if (res.result.results.every((r) => r.sent)) toast.success("Test alerts sent — check your inbox");
        else toast.error("Some test alerts failed to send");
      } catch {
        toast.error("Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className={card}>
        <h2 className="text-lg font-semibold text-foreground mb-3">Owner alerting</h2>
        <ul className="space-y-1 mb-4">
          <Status ok={enabled} label="ALERTING_ENABLED is true" />
          <Status ok={hasRecipient} label="ALERT_EMAIL_TO is set" />
          <Status ok={hasResendKey} label="RESEND_API_KEY is set" />
        </ul>
        <p className="text-sm text-muted-foreground mb-4">
          Sends one clearly-labelled [DRILL] email per alert rule through the real delivery path. It does not touch
          real counters or the hourly cap. One drill per 10 minutes. Site-down alerts come from the external uptime
          monitor, not from here.
        </p>
        <Button onClick={run} disabled={pending}>
          {pending ? "Sending…" : "Send test alerts"}
        </Button>
      </div>

      {result && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-foreground mb-3">Last drill</h3>
          {!result.configured ? (
            <p className="text-sm text-danger">
              Not sent.{" "}
              {result.enabled ? `Missing: ${result.missing.join(", ")}.` : 'ALERTING_ENABLED is not "true".'}
            </p>
          ) : (
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.rule} className="text-sm flex gap-2">
                  <span className={r.sent ? "text-success" : "text-danger"}>{r.sent ? "sent" : "failed"}</span>
                  <span className="text-foreground">{r.rule}</span>
                  {!r.sent && <span className="text-muted-foreground">({r.error ?? r.reason})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
