/**
 * The alerting subsystem's own failure line (SECH-117).
 *
 * It must NOT go through securityEvent()/logError(): app.error and prisma.error feed the
 * error_spike rule, so an alerting failure that emitted one would feed itself. A plain
 * console line is the deliberate exception (allowlisted in console-sinks.test.ts). It carries
 * only a kind and a short string or error NAME — never a raw error, whose message can embed
 * data. In production the console patch (instrumentation.ts) still redacts it.
 */
const warned = new Set<string>();

export function alertingFailure(kind: string, detail?: unknown, opts: { once?: boolean } = {}): void {
  if (opts.once) {
    if (warned.has(kind)) return;
    warned.add(kind);
  }
  const text = typeof detail === "string" ? detail.slice(0, 200) : detail instanceof Error ? detail.name : "";
  console.warn("[alerting]", kind, text);
}

export function resetAlertingWarningsForTest(): void {
  warned.clear();
}
