# Plan: move JedForge production from Railway to Proxmox

> **Status: executed 2026-11-10.** Production runs on Proxmox; see `self-hosting.md` for the current state, the rollback recipe and what changed from this plan (Garage instead of MinIO, Postgres 18, a Cloudflare WAF rule as the write freeze, a systemd timer instead of the GitHub cron).

Drafted 2026-11-10. Goal: stop paying for Railway for a while, with Jamie doing as little as possible. (Written before the move; see the status note above.)

## What Railway currently provides (and the replacement)

| Railway piece | Evidence | Replacement on Proxmox |
|---|---|---|
| App service (`next start`, health `/login`, `preDeployCommand = prisma migrate deploy`) | `railway.toml` | Docker container built from a new `Dockerfile`; migrations run at container start |
| Postgres service | `DATABASE_URL` | `postgres:18` container on a volume, nightly `pg_dump` |
| Object storage bucket (attachments, avatars, editor images, doc files) | `src/lib/s3.ts`, `*.storageapi.dev` in CSP | Garage container (S3-compatible) |
| Public HTTPS on `www.jedforge.com` | Railway edge | Cloudflare Tunnel (`cloudflared`), no router port-forward |
| Auto-deploy on merge to `main` | Railway GitHub link | Pull-based deploy timer on the host |
| Env vars | Railway dashboard | `/opt/jedforge/.env` on the host |
| Daily orphan-cleanup cron | GitHub Action `cleanup-orphaned-attachments.yml` calling the Railway URL | systemd timer on the host (removes the `V1_API_KEY` GitHub-secret dependency) |
| Resend email | external SaaS | unchanged |

## Target layout

New guest, **separate from dev CT 110**: VM `jedforge-prod` cloned from template 9000 (cloud-init; a VM is more robust for Docker than an unprivileged LXC), 2 vCPU / 4 GB / 60 GB, static IP on 10.0.0.x, enabled `onboot`. Docker Compose stack:

- `app` — Next.js production build, port 3000 (internal only)
- `db` — Postgres 18 (matches Railway), bind-mounted volume
- `garage` — S3 API on a public hostname via the tunnel; console bound to localhost only
- `cloudflared` — routes `www.jedforge.com` → `app:3000` and `files.jedforge.com` → `garage:9000`

Keep `NEXTAUTH_URL=https://www.jedforge.com`. Same domain means the OAuth issuer, the Claude.ai MCP connector registration and any stored invite links keep working. Only the tracker base URL for Claude Code's v1 API changes if the domain isn't reused.

## Code changes needed (one PR, branch `jfr-<n>-self-host`)

1. **`Dockerfile` + `docker-compose.yml`** (multi-stage; `prisma generate`, `next build`; entrypoint runs `npx prisma migrate deploy` then `next start`). No Dockerfile exists today.
2. **`src/lib/s3.ts`**: add `forcePathStyle: true` when `S3_FORCE_PATH_STYLE=true` (Garage needs path-style; Railway's bucket doesn't). Keep the `RAILWAY_BUCKET_*` names to avoid touching every call site, or alias new names behind them.
3. **CSP**: `next.config.mjs` `buildCsp()` allows `https://*.storageapi.dev` only. Add the Garage origin (`https://files.jedforge.com`) to `img-src` and `frame-src` via an env-driven value, and update the exact-list assertions in `src/__tests__/security-headers.test.ts` (it pins them deliberately).
4. **Garage CORS** (browser uploads are presigned PUTs straight to the bucket): allow `PUT/GET/HEAD` from `https://www.jedforge.com`. Done in the bootstrap script, not app code.
5. **Rate limiting**: `.context-docs/rate-limiting.md` says client IP is the *leftmost* `X-Forwarded-For` because Railway appends a hop. Cloudflare sets the client IP leftmost too, but verify with a test request through the tunnel before cutover; if wrong, every user shares one rate-limit bucket.
6. **Cleanup cron**: delete the GitHub workflow (or point it at the new host) and add a `jedforge-cleanup.timer` calling `/api/internal/cleanup-orphaned-attachments` locally.
7. Docs: update `CLAUDE.md` (deploy flow, "After merging" section, Railway notes) and `release-controls.md`.

Branch protection stays; the PR flow and required checks are unchanged.

## Automation I can do without Jamie (via the existing SSH key and Proxmox API token)

- Clone template 9000 → `jedforge-prod`, set cloud-init, start it, install Docker.
- Write the compose stack, bootstrap script (create Garage bucket, CORS, app user), backup and cleanup timers, deploy timer.
- Build, start, run `prisma migrate deploy`, smoke-test against `/login`.
- Rehearse the whole migration against a **copy** first (restore a dump into the stack and click through it) before touching production.
- Schedule `vzdump` of the VM and nightly `pg_dump` + `mc mirror` to a second location.

## What only Jamie can do (one sitting, ~15 min)

Claude Code is blocked from reading Railway variables or the public DB URL (auto-mode classifier), so these values must come from Jamie. Put them in **one file**, e.g. `C:\Users\Jamie\jedforge-handoff.env` (never pasted into chat, never committed):

1. From Railway: `DATABASE_PUBLIC_URL`, `RAILWAY_BUCKET_ENDPOINT/NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL_TO`. (Dashboard → service → Variables → Raw editor.)
2. A **Cloudflare tunnel token** for the domain. This needs `jedforge.com` DNS on Cloudflare — **confirm this; it is the biggest unknown.** If DNS lives elsewhere, either move the zone to Cloudflare (free) or use a different ingress (see options below).
3. A **read-only GitHub deploy key** on the repo, or tell me to create it with `gh` (it may be blocked by the classifier like other secret writes).
4. At cutover, approve the final steps (DNS/tunnel switch). I'll ask once.

I will generate fresh `AUTH_SECRET`, Postgres and Garage passwords on the host. Fresh `AUTH_SECRET` logs everyone out once; to avoid that Jamie can add the current value to the handoff file. `V1_API_KEY` can be reused from the local `.env`.

## Phases

1. **Prep (PR)** — code changes above, merged through the normal PR flow. Railway keeps serving; nothing changes for users.
2. **Build the host** — VM, Docker, stack up on the LAN with empty DB. Health check green.
3. **Rehearsal** — `pg_dump` prod (read-only), restore to the new DB, `mc mirror` the bucket to Garage, run the app, verify: login, issue list, an attachment preview, an avatar, a doc PDF preview, password-reset email (use a fake address), MCP/OAuth endpoints, rate-limit IP attribution. Record timings. This phase writes nothing to prod.
4. **Cutover (~15–30 min window, off-hours)** — set `UPLOADS_ENABLED=false` on Railway (kill switch, writes blocked) → final `pg_dump` + bucket sync → restore → bring up tunnel for `www.jedforge.com` → smoke test → re-enable uploads. Rollback is flipping the tunnel/DNS back to Railway, which is untouched.
5. **Soak (1–2 weeks)** — Railway left running but idle (or scaled to zero if desired). Watch backups, alert email, disk. Then delete Railway services, keep the last dump offline.
6. **Cleanup** — update CLAUDE.md, secret-rotation log, remove `RAILWAY_API_TOKEN` guidance, update the v1 tracker URL if it changed.

## Risks and mitigations

- **Home availability** (power, ISP, host reboot): VM `onboot`, UPS if available, and an external uptime monitor (the alerting doc notes the site-down monitor was never set up — do it now, e.g. a free UptimeRobot check mailing `ALERT_EMAIL_TO`). Set expectations that this is a "for a while" environment.
- **Data loss**: previously Railway handled DB durability. Mitigate with nightly dumps plus bucket mirror to a *different* disk or machine, and a monthly restore test.
- **The tracker moves too**: JedForge issue tracking runs on this production instance. Create a JFR issue before cutover and expect a brief gap in v1 API availability.
- **Exposure**: tunnel only, no inbound ports, Garage console and Postgres bound to localhost, host firewall default-deny, unattended-upgrades on.
- **Prisma/Node parity**: build uses the same Node major as CI (20).

## Ingress options if Cloudflare isn't available

- Tailscale Funnel or a small VPS reverse proxy (adds a cost, defeats part of the purpose).
- Port-forward 80/443 + Caddy with Let's Encrypt — works only with a public IPv4 and a stable DNS record; more exposure, and the home IP is published.

## Cost reality check

Savings are Railway's monthly bill. Offsets: Resend stays external, domain stays, Cloudflare Tunnel is free, power for the host. R2 instead of Garage is an alternative for storage (free to 10 GB, no egress) that would remove the second public hostname, at the price of an account and API keys from Jamie.

## Open decisions

1. Is `jedforge.com` DNS on Cloudflare (or can it be)?
2. Garage local vs Cloudflare R2 for files?
3. Keep the same domain (recommended) or cut over to a new one?
4. Do you have a second disk/NAS for backups?
