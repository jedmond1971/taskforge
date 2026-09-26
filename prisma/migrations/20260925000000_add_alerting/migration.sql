-- SECH-117: owner alerting counters and cooldown state.
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertEvent_rule_subject_createdAt_idx" ON "AlertEvent"("rule", "subject", "createdAt");

CREATE TABLE "AlertState" (
    "rule" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("rule", "subject")
);
