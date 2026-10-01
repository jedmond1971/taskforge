import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkSeedTarget } from "../../prisma/seed-guard";

/** SECH-110. The seed wipes all users/orgs/projects, so a remote target must be explicit. */

const LOCAL = "postgresql://postgres:postgres@localhost:5433/taskforge";
const REMOTE = "postgresql://u:p@staging-db.internal.example:5432/railway";

describe("checkSeedTarget", () => {
  it("allows a local database with the default password, preserving today's workflow", () => {
    const r = checkSeedTarget({ DATABASE_URL: LOCAL });
    expect(r).toMatchObject({ ok: true, remote: false, password: "password123" });
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("treats %s as local", (host) => {
    expect(checkSeedTarget({ DATABASE_URL: `postgresql://a:b@${host}:5432/x` })).toMatchObject({ ok: true, remote: false });
  });

  it("lets a local run override the password", () => {
    expect(checkSeedTarget({ DATABASE_URL: LOCAL, SEED_PASSWORD: "x" })).toMatchObject({ ok: true, password: "x" });
  });

  it("refuses a remote host by default, and the message names the host", () => {
    const r = checkSeedTarget({ DATABASE_URL: REMOTE, SEED_PASSWORD: "a-long-random-password-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("staging-db.internal.example");
  });

  it("refuses when SEED_ALLOW_REMOTE names a different host (a stale or pasted value must not unlock another DB)", () => {
    const r = checkSeedTarget({ DATABASE_URL: REMOTE, SEED_ALLOW_REMOTE: "production-db.example", SEED_PASSWORD: "a-long-random-password-1" });
    expect(r.ok).toBe(false);
  });

  it("refuses a remote seed without a strong password, including the local default", () => {
    const base = { DATABASE_URL: REMOTE, SEED_ALLOW_REMOTE: "staging-db.internal.example" };
    expect(checkSeedTarget(base).ok).toBe(false);
    expect(checkSeedTarget({ ...base, SEED_PASSWORD: "password123" }).ok).toBe(false);
    expect(checkSeedTarget({ ...base, SEED_PASSWORD: "short" }).ok).toBe(false);
  });

  it("allows a named remote host with a strong password", () => {
    const r = checkSeedTarget({ DATABASE_URL: REMOTE, SEED_ALLOW_REMOTE: "staging-db.internal.example", SEED_PASSWORD: "a-long-random-password-1" });
    expect(r).toMatchObject({ ok: true, remote: true });
  });

  it("refuses an unset or malformed DATABASE_URL", () => {
    expect(checkSeedTarget({}).ok).toBe(false);
    expect(checkSeedTarget({ DATABASE_URL: "not a url" }).ok).toBe(false);
  });
});

describe("seed.ts wiring", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "prisma", "seed.ts"), "utf8");
  it("runs the guard before the first destructive call and no longer hard-codes the password", () => {
    expect(SRC).toMatch(/checkSeedTarget\(/);
    expect(SRC.indexOf("checkSeedTarget(")).toBeLessThan(SRC.indexOf(".deleteMany()"));
    expect(SRC).not.toMatch(/bcrypt\.hash\(\s*["']/);
  });
});
