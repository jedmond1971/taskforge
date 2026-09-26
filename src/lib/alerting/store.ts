import { Prisma, PrismaClient } from "@prisma/client";

/**
 * The only Prisma access in the alerting subsystem (SECH-117).
 *
 * Everything here is durable Postgres state so counts and cooldowns are shared across
 * instances and survive restarts — the same reasoning as RateLimitAttempt.
 */

/**
 * Alerting's OWN client, deliberately not the shared one (review C1).
 *
 * The shared client in src/lib/prisma.ts registers $on("error") → securityEvent("prisma.error"),
 * and prisma.error feeds the error_spike rule. If alerting used it, one failed alerting query
 * would emit prisma.error → observe() → another alerting query, for as long as the database was
 * unhappy — and every link would compete with real requests for the pool. This client has
 * event-based error logging with NO listener (so nothing reaches stdout either) and a small
 * pool, which also caps alerting's share of connections.
 */
function createAlertingClient(): PrismaClient {
  let datasourceUrl = process.env.DATABASE_URL;
  if (datasourceUrl) {
    try {
      const url = new URL(datasourceUrl);
      url.searchParams.set("connection_limit", "2");
      datasourceUrl = url.toString();
    } catch {
      // An unparseable URL is Prisma's problem to report; fall back to the default datasource.
      datasourceUrl = undefined;
    }
  }
  return new PrismaClient({
    log: [{ emit: "event", level: "error" }],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });
}

const globalForAlerting = globalThis as unknown as { alertingPrisma: PrismaClient | undefined };
export const alertingDb = globalForAlerting.alertingPrisma ?? createAlertingClient();
if (process.env.NODE_ENV !== "production") globalForAlerting.alertingPrisma = alertingDb;

const SENT_RULE = "_sent";
const HOUR = 60 * 60 * 1000;
const STALE_EVENT_MS = 24 * HOUR;
const STALE_STATE_MS = 7 * 24 * HOUR;

/**
 * Record one observation. A DISTINCT observation (one that carries a `detail`) is skipped when the
 * same (rule, subject, detail) is already inside the window — one account failing 1,000 times
 * must not write 1,000 rows (review I1). Without a detail every call writes a row.
 */
export async function recordObservation(
  rule: string,
  subject: string,
  detail?: string,
  dedupeWindowMs = 10 * 60 * 1000
): Promise<void> {
  if (detail !== undefined) {
    const existing = await alertingDb.alertEvent.findFirst({
      where: { rule, subject, detail, createdAt: { gte: new Date(Date.now() - dedupeWindowMs) } },
      select: { id: true },
    });
    if (existing) return;
  }
  await alertingDb.alertEvent.create({ data: { rule, subject, detail } });
  // Keys that never recur are otherwise never cleaned up (same housekeeping as the limiter).
  if (Math.random() < 0.01) await prune().catch(() => {});
}

/**
 * Count observations in the window, never past `limit` (review I1). The caller only needs to
 * know whether the threshold was reached, so a flood costs O(limit) rather than O(rows).
 */
export async function countInWindow(
  rule: string,
  subject: string,
  windowMs: number,
  distinct: boolean,
  limit: number
): Promise<number> {
  const where = { rule, subject, createdAt: { gte: new Date(Date.now() - windowMs) } };
  if (!distinct) return alertingDb.alertEvent.count({ where, take: limit });
  const rows = await alertingDb.alertEvent.findMany({ where, distinct: ["detail"], select: { detail: true }, take: limit });
  return rows.length;
}

/**
 * If (rule, subject) is still inside its cooldown, count the swallowed event and say so.
 * One cheap UPDATE, so an attacker's later attempts cost one statement each instead of a row,
 * a window count, the cap query and a claim (review I1). claimSend stays authoritative for the
 * race at the moment the cooldown expires.
 */
export async function suppressIfCooling(rule: string, subject: string, cooldownMs: number): Promise<boolean> {
  const affected = await alertingDb.$executeRaw(Prisma.sql`
    UPDATE "AlertState" SET "suppressedCount" = "suppressedCount" + 1
    WHERE "rule" = ${rule} AND "subject" = ${subject}
      AND "lastSentAt" >= now() - (${cooldownMs}::double precision * interval '1 millisecond')
  `);
  return affected > 0;
}

/**
 * Atomically claim the right to send for (rule, subject).
 *
 * One statement, so two instances cannot both win: under READ COMMITTED the loser's
 * ON CONFLICT ... WHERE re-checks the row the winner just wrote and finds it inside the
 * cooldown. Uses the database clock throughout. `prior` is read from the statement snapshot,
 * i.e. the suppressed count as it stood BEFORE the winner reset it.
 */
export async function claimSend(
  rule: string,
  subject: string,
  cooldownMs: number
): Promise<{ claimed: boolean; suppressed: number }> {
  const rows = await alertingDb.$queryRaw<Array<{ claimed: number; suppressed: number }>>(Prisma.sql`
    WITH prior AS (
      SELECT "suppressedCount" FROM "AlertState" WHERE "rule" = ${rule} AND "subject" = ${subject}
    ), won AS (
      INSERT INTO "AlertState" ("rule", "subject", "lastSentAt", "suppressedCount")
      VALUES (${rule}, ${subject}, now(), 0)
      ON CONFLICT ("rule", "subject") DO UPDATE
        SET "lastSentAt" = now(), "suppressedCount" = 0
        WHERE "AlertState"."lastSentAt" < now() - (${cooldownMs}::double precision * interval '1 millisecond')
      RETURNING 1 AS one
    )
    SELECT (SELECT count(*) FROM won)::int AS claimed,
           COALESCE((SELECT "suppressedCount" FROM prior), 0)::int AS suppressed
  `);
  const { claimed, suppressed } = rows[0];
  if (claimed > 0) return { claimed: true, suppressed };
  // A loss means the row exists and is inside its cooldown: remember we swallowed one.
  await alertingDb.alertState.updateMany({ where: { rule, subject }, data: { suppressedCount: { increment: 1 } } });
  return { claimed: false, suppressed: 0 };
}

/**
 * After a failed send: pretend the last send was `cooldownMs - retryMs` ago, so a matching
 * event can retry after `retryMs` instead of being silenced for the whole cooldown.
 */
export async function backdateClaim(rule: string, subject: string, cooldownMs: number, retryMs: number): Promise<void> {
  await alertingDb.alertState.updateMany({
    where: { rule, subject },
    data: { lastSentAt: new Date(Date.now() - cooldownMs + retryMs) },
  });
}

export async function recordSent(): Promise<void> {
  await alertingDb.alertEvent.create({ data: { rule: SENT_RULE, subject: "global" } });
}

export async function sentInLastHour(): Promise<number> {
  return alertingDb.alertEvent.count({ where: { rule: SENT_RULE, createdAt: { gte: new Date(Date.now() - HOUR) } } });
}

export async function prune(): Promise<void> {
  await alertingDb.alertEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - STALE_EVENT_MS) } } });
  await alertingDb.alertState.deleteMany({ where: { lastSentAt: { lt: new Date(Date.now() - STALE_STATE_MS) } } });
}
