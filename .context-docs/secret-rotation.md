# Environment variables and secret rotation (SECH-113)

Names only, never values. Compiled 2026-10-01 from the code (`grep process.env`), `.env.example`, `railway.toml` and `.github/workflows`. **Production's actual variable list is not readable from Claude Code** (the Railway `variables` query is blocked as credential materialization), so "set in prod?" below is inferred from the code and must be checked against the Railway dashboard — a variable listed here but absent there (or the reverse) is a finding, record it.

Staging does not exist yet (SECH-110). When it does, it must get its **own** value for every secret marked "never share".

## Inventory

### Secrets

| Name | Purpose | Where it lives | Share across envs? |
|---|---|---|---|
| `AUTH_SECRET` | Auth.js v5 key that encrypts/signs the JWT session cookie | Railway; local `.env` | **Never.** Local value was committed in early git history — never reuse it anywhere |
| `NEXTAUTH_SECRET` | **Dead.** Legacy name; `next-auth` 5.0.0-beta.32 reads `AUTH_SECRET ?? NEXTAUTH_SECRET`, so it only matters if `AUTH_SECRET` is unset. Nothing in `src/` reads it (only the log-redaction list). Production holds a *different* value from `AUTH_SECRET` (checked 2026-10-01) | Railway; local `.env` | Never. Safe to delete from Railway; it still looks like a live secret to anyone auditing, and a future change that makes it live would silently change the signing key |
| `V1_API_KEY` | Shared secret for `/api/v1/*` (Claude Code's tracker) and `/api/internal/cleanup-orphaned-attachments` | Railway; local `.env`; **GitHub Actions secret** (daily cleanup cron) | Intentionally the same value on all three; never in staging |
| `DATABASE_URL` | Postgres connection string (Railway internal network). Also read by `alerting/store.ts` and Prisma | Railway (reference to the Postgres service); local `.env` (Docker, localhost) | Never. Integration tests refuse any non-localhost host |
| `RAILWAY_BUCKET_ACCESS_KEY_ID` / `RAILWAY_BUCKET_SECRET_ACCESS_KEY` | S3-compatible credentials for attachments, avatars, editor images, doc files | Railway | Never (a staging bucket needs its own) |
| `RESEND_API_KEY` | Invite emails and owner alerts | Railway | Never |
| `ANTHROPIC_API_KEY` | AI chat (`/api/ai/chat`) | Railway (Jamie's deployment only); local `.env` | Never; absent on any buyer deployment |

Held outside the app, but part of the same blast radius:

| Name | Purpose | Where it lives |
|---|---|---|
| `RAILWAY_API_TOKEN` | Railway GraphQL API (deploy status, variable upserts) | `~/.bashrc` on Jamie's machine only — never in the app or CI |
| `DATABASE_PUBLIC_URL` | Public proxy URL for direct prod DB access | Railway only; fetching it is blocked for Claude Code, so Jamie runs it |
| OAuth tokens, org API keys | User-facing credentials, stored as sha256 hashes in the DB | DB (`OAuth*Token`, `ApiKey`) |

### Non-secret configuration

| Name | Purpose | Default |
|---|---|---|
| `NEXTAUTH_URL` | Public base URL; also the OAuth issuer (falls back to `https://www.jedforge.com`) | — |
| `RAILWAY_BUCKET_ENDPOINT`, `RAILWAY_BUCKET_NAME`, `RAILWAY_BUCKET_REGION` | Bucket location | — |
| `ANTHROPIC_MODEL` | AI chat model | `claude-sonnet-5` |
| `AI_CHAT_ENABLED` | AI chat gate, Jamie-only | off |
| `ALERTING_ENABLED`, `ALERT_EMAIL_TO` | Owner alerting; the address is personal data, not committed | off |
| `RATE_LIMIT_MODE` | `monitor` = log-only rollback switch | enforcing |
| `OAUTH_MCP_ENABLED`, `UPLOADS_ENABLED`, `EXTERNAL_API_ENABLED` | Kill switches ([kill-switches.md](kill-switches.md)) | on |
| `NODE_ENV`, `PORT` | Set by Railway / Next | — |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, `ADMIN_ROLE` | Read only by `scripts/create-user.ts`. `ADMIN_PASSWORD` is a credential: don't leave it set in Railway after use | unset |
| `TEST_ONLY_SECRET` | Test fixtures only; not a real secret | — |

`src/lib/redaction.ts` masks `AUTH_SECRET`, `NEXTAUTH_SECRET` and `DATABASE_URL` values found in log lines; see [log-redaction.md](log-redaction.md) before adding another secret name.

## Rotation procedures

Every procedure ends the same way: confirm the new value works, then **retire the old one**, then record the date in the log at the bottom. Generate random values with `openssl rand -base64 32`; never paste a value into chat, an issue or a commit.

Setting a Railway variable (dashboard or `variableUpsert`, see [local-dev-tooling.md](local-dev-tooling.md)) **redeploys the service** (~2–3 min). There is no hot reload; the old deployment serves until the new one swaps in.

### `AUTH_SECRET` / `NEXTAUTH_SECRET`
- **Impact:** every logged-in user is logged out (session cookies no longer decrypt) and must sign in again. No data loss. OAuth/MCP tokens and API keys are unaffected (opaque DB-hashed tokens, not derived from this secret).
- **Steps:** 1) generate one value; 2) set `AUTH_SECRET` in Railway (`NEXTAUTH_SECRET` is not read, don't bother keeping it in sync); 3) wait for the deploy; 4) confirm an old session lands on `/login` and a fresh login works; 5) local `.env` needs its own, different value. Zero-logout rotation via `AUTH_SECRET_1`: `@auth/core` supports extra secrets, but `next-auth`'s wrapper sets `config.secret` to a string first, which likely bypasses it — untested, don't rely on it.
- **When:** immediately if exposed. Otherwise no scheduled rotation (it invalidates all sessions); `User.sessionVersion` handles per-user invalidation without this.

### `V1_API_KEY`
- **Impact:** Claude Code's v1 API calls and the daily attachment-cleanup cron get 401 between the Railway deploy swapping in and the other two copies being updated. Nothing user-facing.
- **Three copies, all must change:** Railway variable, local `/home/jamie/Projects/TaskForge/.env`, and the **GitHub Actions secret** `V1_API_KEY` (`gh secret set V1_API_KEY --repo jedmond1971/taskforge`). Missing the GitHub copy fails the cleanup cron silently (the job goes red, nothing pages anyone).
- **Steps:** 1) generate a value; 2) update the GitHub secret and local `.env` first (both are inert until Railway changes); 3) set the Railway variable; 4) after the deploy: `curl -s -o /dev/null -w "%{http_code}" -H "X-Internal-Api-Key: <new>" https://taskforge-production-099b.up.railway.app/api/v1/projects` → `200`, same call with the old value → `401`; 5) re-run the cron: `gh workflow run cleanup-orphaned-attachments.yml` and confirm it passes.
- Read the key into the shell with `set -a; source .env; set +a` — see CLAUDE.md for the `source` gotcha.

### Railway bucket credentials
- **Impact:** until the new pair is live, presign/upload/download fail (attachments, avatars, doc files). Existing objects are untouched.
- **Steps:** 1) Railway dashboard → bucket → credentials; 2) set `RAILWAY_BUCKET_ACCESS_KEY_ID` and `RAILWAY_BUCKET_SECRET_ACCESS_KEY` on the service; 3) after the deploy upload a test attachment and download it.
- **Unverified:** whether Railway lets old and new credentials overlap, or invalidates the old pair when you regenerate. Assume the old pair dies instantly and schedule it accordingly; record the real behaviour here after the first rotation.

### Resend
- **Impact:** invite emails and owner alerts fail between key swap and deploy completion. Nothing is queued — an invite sent in that window must be resent.
- **Steps:** 1) Resend dashboard → create a new API key (send-only is enough); 2) set `RESEND_API_KEY` in Railway; 3) after the deploy send a test alert from `/admin/alerting`; 4) **then** delete the old key in Resend.

### Anthropic
- **Impact:** AI chat errors until the deploy completes. Jamie-only feature.
- **Steps:** 1) console.anthropic.com → create a new key; 2) set `ANTHROPIC_API_KEY` in Railway and local `.env`; 3) send a chat message on an issue page; 4) delete the old key.

### `DATABASE_URL` (Postgres password)
- **Impact:** the largest of the set: every query fails if the app and the database disagree. Take it in a quiet window.
- **Steps:** 1) change the role's password in Postgres (`ALTER USER … PASSWORD …`, run by Jamie via the public proxy); 2) update the Postgres service's password variable so Railway's reference variables resolve to the new value; 3) redeploy the app; 4) confirm `/login` loads and a project page renders.
- **Unverified:** on Railway's Postgres template, changing the password *variable* alone does not change the password of an already-initialised database — step 1 is what actually changes it. Rehearse against a throwaway database before doing this in production. Order matters: the app keeps working only if the DB and the variable change close together.

### `RAILWAY_API_TOKEN`
- **Impact:** none to users. Claude Code loses deploy-status checks until `~/.bashrc` is updated.
- **Steps:** Railway account → Tokens → create new; replace the line in `~/.bashrc`; re-run the `deployments(...)` query; revoke the old token. (A `Not Authorized` result from that query once appeared with the old token — see local-dev-tooling.md.)

### User-facing credentials: OAuth clients/tokens and org API keys
- **Org API keys:** an org OWNER/ADMIN revokes one in Org settings → API keys (`revokeApiKey`, sets `ApiKey.revokedAt`). To kill every key a user made: `revokeApiKeysForUser`.
- **OAuth tokens:** there is **no UI** to revoke a single grant or client. Revocation happens only as a side effect — password change, admin password reset, role change, or org removal (`revokeOAuthTokensForUser`, SECH-94). In an incident, revoke everything directly in SQL (Jamie runs it via the proxy): `UPDATE "OAuthAccessToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;` and the same for `"OAuthRefreshToken"`. Access tokens live 1 h and refresh tokens 90 days, so revoking only access tokens is not enough. To stop new grants first, flip `OAUTH_MCP_ENABLED=false` ([kill-switches.md](kill-switches.md)).
- **Gap:** a per-client/per-grant revoke UI does not exist; file it if grants ever need routine revocation.

## Rotation log

"Unknown — treat as never rotated" means the provider's dashboard shows no creation date and no rotation is recorded in the repo, memory notes or CI. Railway shows no per-variable, bucket-credential, Postgres-password or token creation dates at all (confirmed 2026-10-01); Resend and Anthropic do. Record a date here the first time one is rotated, so the next review has a real baseline.

| Secret | Last rotated | Note |
|---|---|---|
| `AUTH_SECRET` | unknown — treat as never rotated | Railway shows no per-variable dates. Local value was committed in early history; production value unknown |
| `NEXTAUTH_SECRET` | unknown |  Dead variable (see inventory); differs from `AUTH_SECRET` in prod |
| `V1_API_KEY` | 2026-10-01 | Rehearsal run by Jamie (Claude Code's classifier blocks secret-store writes). Railway deploy `SUCCESS`, new key `200` / no key `401`, manual cleanup-cron run green. Whole procedure took ~10 min; old-key 401 was not directly checked (backup file removed early) |
| Bucket credentials | unknown — treat as never rotated | Railway shows no creation date (checked 2026-10-01) |
| `RESEND_API_KEY` | created ~July 2026 (Resend dashboard shows "3 months ago" on 2026-10-01; exact date not shown) | Never rotated since creation, ~3 months old |
| `ANTHROPIC_API_KEY` | created 2026-07-31 (Anthropic console) | Never rotated since creation, ~2 months old |
| `DATABASE_URL` / Postgres password | unknown — treat as never rotated | Railway shows no creation date (checked 2026-10-01) |
| `RAILWAY_API_TOKEN` | unknown — treat as never rotated | Railway shows no creation date (checked 2026-10-01) |
