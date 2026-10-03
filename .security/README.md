# `.security/`

Machine-readable mirrors of security decisions that CI has to enforce.

## `audit-allowlist.json`

High/critical npm advisories that the dependency-audit gate
(`scripts/audit-gate.mjs`, SECH-104) should not fail on, because the risk has
been formally accepted in the security risk register (the SECH docs space,
SECH-103). CI cannot read that register, so an acceptance that needs to change
CI behaviour has to be mirrored here.

Each entry is an object:

| Field | Meaning |
|---|---|
| `ghsa` | Advisory id exactly as npm reports it, e.g. `GHSA-cp6q-959q-f8rh`. |
| `riskId` | The risk-register row this mirrors, e.g. `R-01`. Required. |
| `severity` | Severity at the time of acceptance, for the reader's benefit. |
| `expires` | `YYYY-MM-DD`, valid through the end of that day (UTC). Required. |
| `reason` | Why this is acceptable — reachability, compensating control. |

Rules the gate enforces itself:

- An entry with no `riskId` or no `expires` is rejected outright. An acceptance
  with no owner decision behind it and no end date is how an allowlist rots.
- Once `expires` passes and the advisory is **still present**, the build goes
  red. Renew the register decision or fix the dependency; don't just push the
  date out.
- Once `expires` passes and the advisory is **gone**, the entry is reported as
  stale and should be deleted. That's a warning, not a failure.

Only high and critical advisories are gated, and only on the production
dependency tree (`npm audit --omit=dev`). Moderates and below are reported by
the weekly audit workflow but never block a merge — the 29 moderate TipTap
advisories (R-01, SECH-124) are the standing example.

Current entries: R-16 (`braces` GHSA-vfj7-8cjw-p6xm, accepted by Jamie 2026-10-03,
expires 2026-12-31). As of 2026-09-23 the production tree had no high or
critical advisories.
