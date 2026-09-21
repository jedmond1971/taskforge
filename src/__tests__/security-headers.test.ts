import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import { POST as cspReport } from "@/app/api/csp-report/route";

/**
 * SECH-84: baseline security headers + CSP (report-only phase). Loads the real
 * next.config.mjs and calls its headers() so a change to the config — or a
 * dropped header — fails CI. The header values Next serves are exactly what
 * headers() returns.
 */

const CONFIG = path.join(__dirname, "..", "..", "next.config.mjs");

async function loadHeaders(): Promise<Record<string, string>> {
  const mod = await import(/* @vite-ignore */ CONFIG);
  const rules = await mod.default.headers();
  const catchAll = rules.find((r: { source: string }) => r.source === "/:path*");
  expect(catchAll, "headers() must cover every route").toBeDefined();
  return Object.fromEntries(catchAll.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
}

const directive = (csp: string, name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? [];

afterEach(() => vi.unstubAllEnvs());

describe("baseline headers", () => {
  it("sets nosniff, referrer policy, permissions policy and frame protection", async () => {
    const h = await loadHeaders();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(h["Permissions-Policy"]).toContain(`${feature}=()`);
    }
  });

  it("sends HSTS only in production builds", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await loadHeaders())["Strict-Transport-Security"]).toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    expect((await loadHeaders())["Strict-Transport-Security"]).toMatch(/^max-age=\d{7,}$/);
  });
});

describe("Content-Security-Policy (report-only)", () => {
  it("is report-only, not enforcing, until the review period ends", async () => {
    const h = await loadHeaders();
    expect(h["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("locks down the non-negotiables", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await loadHeaders())["Content-Security-Policy-Report-Only"];
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(csp, "report-uri")).toEqual(["/api/csp-report"]);
  });

  it("allows exactly the documented external sources, and no wildcards or http:", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await loadHeaders())["Content-Security-Policy-Report-Only"];
    expect(directive(csp, "img-src")).toEqual(["'self'", "blob:", "https://*.storageapi.dev"]);
    expect(directive(csp, "frame-src")).toEqual(["'self'", "https://*.storageapi.dev"]);
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
    expect(directive(csp, "font-src")).toEqual(["'self'"]);
    expect(csp).not.toMatch(/(^|\s)(\*|https?:)(\s|;|$)/);
  });

  it("keeps unsafe-eval and websockets out of production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = (await loadHeaders())["Content-Security-Policy-Report-Only"];
    expect(prod).not.toContain("unsafe-eval");
    expect(directive(prod, "connect-src")).not.toContain("ws:");
    vi.stubEnv("NODE_ENV", "development");
    const dev = (await loadHeaders())["Content-Security-Policy-Report-Only"];
    expect(dev).toContain("'unsafe-eval'");
  });
});

describe("POST /api/csp-report", () => {
  const post = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    cspReport(
      new Request("http://localhost/api/csp-report", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "x-forwarded-for": ip, ...headers },
      })
    );

  it("logs only origin+path, never query strings (invite tokens, presigned signatures)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post(
      {
        "csp-report": {
          "document-uri": "https://www.jedforge.com/invite/SECRET-TOKEN?code=abc",
          "blocked-uri": "https://x.storageapi.dev/o/file.png?X-Amz-Signature=SIG",
          "effective-directive": "img-src",
        },
      },
      "10.0.0.1"
    );
    expect(res.status).toBe(204);
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("img-src");
    expect(logged).not.toContain("X-Amz-Signature");
    expect(logged).not.toContain("code=abc");
    warn.mockRestore();
  });

  it("answers 204 and logs nothing for junk or oversized bodies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post("not json", "10.0.0.2")).status).toBe(204);
    expect((await post({ "csp-report": { x: "y".repeat(9000) } }, "10.0.0.2")).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops logging an IP that floods it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 60; i++) await post({ "csp-report": { "effective-directive": "img-src" } }, "10.0.0.3");
    expect(warn.mock.calls.length).toBe(30);
    warn.mockRestore();
  });
});
