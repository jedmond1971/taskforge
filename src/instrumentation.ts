import { redact } from "@/lib/redaction";

type ConsoleLike = Pick<Console, "log" | "warn" | "error">;
type Method = "log" | "warn" | "error";

const METHODS: Method[] = ["log", "warn", "error"];
const PATCHED = Symbol.for("sech115.consolePatched");

/**
 * SECH-115: Next.js logs uncaught route errors itself, carrying the same Prisma payload,
 * and nothing else intercepts that. `console.log` is wrapped as well as `error` because
 * Prisma's own logger uses `log` — patching only `error` looks correct and is not.
 *
 * Production only: in development the full payload is what you want while debugging.
 *
 * No cap is passed to redact(). The cap is opt-in precisely because this patch redacts
 * whole log lines, and a default cap would silently truncate every long line in production.
 */
export function installConsoleRedaction(target: ConsoleLike, env: string | undefined): void {
  if (env !== "production") return;

  const marked = target as ConsoleLike & { [PATCHED]?: boolean };
  if (marked[PATCHED]) return; // wrapping the wrapper would redact twice
  marked[PATCHED] = true;

  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = ((...args: unknown[]) => {
      let safe: unknown[];
      try {
        safe = args.map((a) => redact(a));
      } catch {
        // Fail open: a dropped error log is worse than an unredacted one.
        safe = args;
      }
      // `original` was captured before wrapping, so this cannot re-enter the patch.
      original(...(safe as Parameters<ConsoleLike[Method]>));
    }) as ConsoleLike[Method];
  }
}

export async function register(): Promise<void> {
  installConsoleRedaction(console, process.env.NODE_ENV);
}
