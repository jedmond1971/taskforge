#!/usr/bin/env node
/**
 * Post-deploy security smoke checks (SECH-110 / SECH-120).
 *
 *   node scripts/smoke-check.mjs https://staging.example.com [--ai off|on]
 *
 * Unauthenticated requests only: no credentials are read or sent, nothing is written, so it is safe to point at
 * production as well. Exits 1 if any check fails. Dependency-free (Node 18+ fetch).
 *
 * `--ai off` additionally asserts AI chat answers 404 (it must be off anywhere that is not Jamie's own deployment).
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/+$/, "");
const aiFlag = args.includes("--ai") ? args[args.indexOf("--ai") + 1] : undefined;
if (!base) {
  console.error("usage: node scripts/smoke-check.mjs <base-url> [--ai off|on]");
  process.exit(2);
}
const isHttps = base.startsWith("https://");

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
async function req(path, init = {}) {
  return fetch(base + path, { redirect: "manual", headers: { "User-Agent": "jedforge-smoke-check" }, ...init });
}
function expectStatus(res, ...allowed) {
  if (!allowed.includes(res.status)) throw new Error(`expected ${allowed.join("/")}, got ${res.status}`);
  return `HTTP ${res.status}`;
}

await check("login page is up", async () => expectStatus(await req("/login"), 200));

await check("baseline security headers on /login", async () => {
  const h = (await req("/login")).headers;
  const missing = [];
  if (h.get("x-content-type-options") !== "nosniff") missing.push("x-content-type-options");
  if (!h.get("x-frame-options")) missing.push("x-frame-options");
  if (!h.get("referrer-policy")) missing.push("referrer-policy");
  if (!h.get("permissions-policy")) missing.push("permissions-policy");
  if (!h.get("content-security-policy") && !h.get("content-security-policy-report-only")) missing.push("content-security-policy");
  if (isHttps && !h.get("strict-transport-security")) missing.push("strict-transport-security");
  if (missing.length) throw new Error("missing: " + missing.join(", "));
  return "all present";
});

await check("request id is set on responses", async () => {
  const id = (await req("/login")).headers.get("x-request-id");
  if (!id) throw new Error("no x-request-id header");
  return "present";
});

await check("unauthenticated dashboard redirects to /login", async () => {
  const res = await req("/");
  expectStatus(res, 307, 302, 303);
  const loc = res.headers.get("location") ?? "";
  if (!loc.includes("/login")) throw new Error(`redirected to ${loc}`);
  return `-> ${loc}`;
});

await check("v1 API rejects a missing key", async () => expectStatus(await req("/api/v1/projects"), 401));
await check("external API rejects a missing key", async () => expectStatus(await req("/api/external/v1/projects"), 401));
await check("avatar requires a session", async () => expectStatus(await req("/api/avatar"), 401));
await check("MCP rejects a missing token", async () =>
  expectStatus(await req("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "jedforge-smoke-check" }, body: "{}" }), 401));
await check("cleanup endpoint rejects a missing key", async () =>
  expectStatus(await req("/api/internal/cleanup-orphaned-attachments", { method: "POST" }), 401));

await check("OAuth issuer matches this deployment's URL", async () => {
  const res = await req("/.well-known/oauth-authorization-server");
  expectStatus(res, 200);
  const { issuer } = await res.json();
  if (String(issuer).replace(/\/+$/, "") !== base) {
    throw new Error(`issuer is ${issuer}, expected ${base} — NEXTAUTH_URL is probably still pointing somewhere else`);
  }
  return `issuer ${issuer}`;
});
await check("OAuth protected-resource metadata is served", async () => {
  const res = await req("/.well-known/oauth-protected-resource");
  expectStatus(res, 200);
  const { resource } = await res.json();
  if (!String(resource).startsWith(base)) throw new Error(`resource is ${resource}, expected it under ${base}`);
  return `resource ${resource}`;
});

if (aiFlag === "off") {
  await check("AI chat is disabled", async () =>
    expectStatus(await req("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "jedforge-smoke-check" }, body: "{}" }), 404));
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed against ${base}`);
process.exit(failed ? 1 : 0);
