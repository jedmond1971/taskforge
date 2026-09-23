<!--
  JedForge pull request. Fill in what applies and delete what doesn't — a docs-only or
  dependency-bump PR does not need the full security section, but say so rather than
  leaving it blank.

  The security fields exist because `main` is protected (SECH-102) and every change now
  arrives this way. A reviewer should be able to tell, without reading the diff, what could
  go wrong with this change and how it would be undone.
-->

## What and why

<!-- One or two sentences. Link the SECH/JFR issue. -->

## Threat or risk addressed

<!-- What could an attacker (or an honest mistake) do before this change that they can't now?
     "None — internal refactor" is a valid answer. -->

## Blast radius

- **Routes / actions touched:**
- **Data touched:**
- **Auth mechanism involved:** <!-- session / OAuth token / org API key / internal V1 secret / none -->
- **Tenancy:** <!-- does anything here cross an org or project boundary? -->

## Change summary

<!-- The shape of the change, not a file list — the diff already has that. -->

## Negative tests added

<!-- The tests that fail if the control is removed. If you added none, say why.
     For a security control, say how you confirmed the test actually detects its absence. -->

## Verification

- [ ] `npm run lint` — 0 errors, no new warnings
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test`
- [ ] `npm run test:integration` <!-- required when touching auth, permissions.ts, server actions or API routes -->
- [ ] Manual / staging verification: <!-- what you actually exercised, or "n/a" -->

## Dependency or config changes

<!-- New packages (and the lockfile), env vars, CI required checks, Railway settings.
     A new env var that production needs must be named here. -->

## Logging and privacy impact

<!-- Does this log anything new? Could a secret, token, presigned URL or document body
     reach a log line or an error message? -->

## Rollback / disable path

<!-- How this is undone if it misbehaves in production: revert the commit, flip a feature
     flag, set RATE_LIMIT_MODE=monitor, etc. Migrations: is the revert safe with the new
     column still present? -->

## Residual risk and follow-up

<!-- What this deliberately does not fix, and the issue tracking it. -->
