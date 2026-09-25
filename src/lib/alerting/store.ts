import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The only Prisma access in the alerting subsystem (SECH-117).
 *
 * Everything here is durable Postgres state so counts and cooldowns are shared across
 * instances and survive restarts — the same reasoning as RateLimitAttempt.
 */

const SENT_RULE = "_sent";
const HOUR = 60 * 60 * 1000;
const STALE_EVENT_MS = 24 * HOUR;
const STALE_STATE_MS = 7 * 24 * HOUR;

export async function recordObservation(rule: string, subject: string, detail?: string): Promise<void> {
  await prisma.alertEvent.create({ data: { rule, subject, detail } });
  // Keys that never recur are otherwise never cleaned up (same housekeeping as the limiter).
  if (Math.random() < 0.01) await prune().catch(() => {});
}

export async function countInWindow(
  rule: string,
  subject: string,
  windowMs: number,
  distinct: boolean
): Promise<number> {
  const where = { rule, subject, createdAt: { gte: new Date(Date.now() - windowMs) } };
  if (!distinct) return prisma.alertEvent.count({ where });
  const rows = await prisma.alertEvent.findMany({ where, distinct: ["detail"], select: { detail: true } });
  return rows.length;
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
  const rows = await prisma.$queryRaw<Array<{ claimed: number; suppressed: number }>>(Prisma.sql`
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
  await prisma.alertState.updateMany({ where: { rule, subject }, data: { suppressedCount: { increment: 1 } } });
  return { claimed: false, suppressed: 0 };
}

/**
 * After a failed send: pretend the last send was `cooldownMs - retryMs` ago, so a matching
 * event can retry after `retryMs` instead of being silenced for the whole cooldown.
 */
export async function backdateClaim(rule: string, subject: string, cooldownMs: number, retryMs: number): Promise<void> {
  await prisma.alertState.updateMany({
    where: { rule, subject },
    data: { lastSentAt: new Date(Date.now() - cooldownMs + retryMs) },
  });
}

export async function recordSent(): Promise<void> {
  await prisma.alertEvent.create({ data: { rule: SENT_RULE, subject: "global" } });
}

export async function sentInLastHour(): Promise<number> {
  return prisma.alertEvent.count({ where: { rule: SENT_RULE, createdAt: { gte: new Date(Date.now() - HOUR) } } });
}

export async function prune(): Promise<void> {
  await prisma.alertEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - STALE_EVENT_MS) } } });
  await prisma.alertState.deleteMany({ where: { lastSentAt: { lt: new Date(Date.now() - STALE_STATE_MS) } } });
}
