import { getClientIp } from "@/lib/rate-limit";

// Receives CSP violation reports (SECH-84). Public by design — browsers POST here
// without our auth — so it is abusable as a log-spam sink: the body is size-capped,
// each IP gets a small in-memory quota (like the external API limiter), nothing is
// persisted, and it always answers 204 so it reveals nothing.

const MAX_BODY_BYTES = 8 * 1024;
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;
const MAX_TRACKED_IPS = 1000;

const windows = new Map<string, { count: number; windowStart: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  if (windows.size > MAX_TRACKED_IPS) {
    for (const [key, w] of Array.from(windows)) {
      if (now - w.windowStart >= WINDOW_MS) windows.delete(key);
    }
    if (windows.size > MAX_TRACKED_IPS) windows.clear();
  }
  const w = windows.get(ip);
  if (!w || now - w.windowStart >= WINDOW_MS) {
    windows.set(ip, { count: 1, windowStart: now });
    return true;
  }
  w.count += 1;
  return w.count <= MAX_REPORTS_PER_WINDOW;
}

// document-uri / blocked-uri can carry secrets (invite tokens, OAuth params,
// presigned-URL signatures). Log only origin + path, capped.
function scrub(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return value.slice(0, 50); // keywords like "inline", "eval", "data"
  }
}

const noContent = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  if (!allow(getClientIp(request))) return noContent();

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return noContent();

  let text: string;
  try {
    text = await request.text();
  } catch {
    return noContent();
  }
  if (text.length > MAX_BODY_BYTES) return noContent();

  let report: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(text);
    // Legacy report-uri format: { "csp-report": {...} }. Reporting API format: [{ body: {...} }].
    report = parsed?.["csp-report"] ?? (Array.isArray(parsed) ? parsed[0]?.body : undefined);
  } catch {
    return noContent();
  }
  if (!report || typeof report !== "object") return noContent();

  console.warn(
    "[csp-report]",
    JSON.stringify({
      directive: report["effective-directive"] ?? report["violated-directive"] ?? report["effectiveDirective"],
      blocked: scrub(report["blocked-uri"] ?? report["blockedURL"]),
      document: scrub(report["document-uri"] ?? report["documentURL"]),
      source: scrub(report["source-file"] ?? report["sourceFile"]),
      line: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
      disposition: report["disposition"],
    })
  );
  return noContent();
}
