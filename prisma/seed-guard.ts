/**
 * Decides whether prisma/seed.ts may run (SECH-110).
 *
 * The seed WIPES every user, organization and project before inserting fixtures, and its
 * logins use a shared password. That is fine on a local Docker database and catastrophic
 * against a real one, so a remote target must be named explicitly and given a real password.
 */
export type SeedDecision =
  | { ok: true; password: string; remote: boolean; host: string }
  | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_LOCAL_PASSWORD = "password123";
const MIN_REMOTE_PASSWORD_LENGTH = 16;

export function checkSeedTarget(env: Record<string, string | undefined>): SeedDecision {
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return { ok: false, error: "DATABASE_URL is unset or not a valid URL; refusing to seed." };
  }
  if (!host) return { ok: false, error: "DATABASE_URL has no host; refusing to seed." };

  if (LOCAL_HOSTS.has(host)) {
    return { ok: true, password: env.SEED_PASSWORD || DEFAULT_LOCAL_PASSWORD, remote: false, host };
  }

  if (env.SEED_ALLOW_REMOTE !== host) {
    return {
      ok: false,
      error:
        `Refusing to seed remote database host "${host}": the seed deletes all users, organizations and ` +
        `projects. To seed a non-production environment on purpose, set SEED_ALLOW_REMOTE to exactly that ` +
        `host name. Never do this against production.`,
    };
  }
  const password = env.SEED_PASSWORD ?? "";
  if (password.length < MIN_REMOTE_PASSWORD_LENGTH || password === DEFAULT_LOCAL_PASSWORD) {
    return {
      ok: false,
      error: `Seeding a remote database needs SEED_PASSWORD of at least ${MIN_REMOTE_PASSWORD_LENGTH} characters (the local default is not allowed).`,
    };
  }
  return { ok: true, password, remote: true, host };
}
