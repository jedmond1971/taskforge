# Secret scanning (SECH-112)

## CI job: `Secret scan`

Defined in `.github/workflows/ci.yml`. It runs on every PR and on every push to `main`, and it is a **required check** on `main` (see `release-controls.md`).

- Runs gitleaks `v8.30.1` (pinned Docker image `ghcr.io/gitleaks/gitleaks`) with `git --log-opts="--all"` on a `fetch-depth: 0` checkout. It scans **the full history of every branch and tag**, not just the new commits, so a secret pushed to any branch fails every later run until it's resolved.
- **Self-test first:** the job generates a random `ghp_…`-shaped token at runtime (it's never committed) and fails if gitleaks *doesn't* detect it. This guards against a broken image or ruleset passing silently.
- `--redact` is on. The repo is **public**, so logs and the `gitleaks-report` artifact must never contain secret values.
- Config: `.gitleaks.toml` extends the default ruleset. **Allowlist only triaged false positives, each with a written reason. Never allowlist a live credential. Rotate it instead:** removing a secret from history doesn't un-leak it from a public repo.

## What gitleaks does not catch: exact-value history search

gitleaks' generic rule needs high-entropy strings. A low-entropy, human-phrase secret (like the old dev `NEXTAUTH_SECRET` below) passes it cleanly. For a full audit, also search every commit on every ref, including `refs/stash`, for the **exact values** of real secrets. Read the values from `.env` and `~/.bashrc` inside a script, compare as bytes, and print only key names and match counts. Pipe `git log --all -p --text` into Python and read `sys.stdin.buffer`, because the history contains binary blobs that break utf-8 decoding.

## Baseline audit result (2026-09-22)

- **gitleaks:** 305 commits across all refs, no leaks.
- **Exact-value search** over all history, the stash, untracked files (including inside `.docx`/`.zip`), and a fresh production build (`.next/static`, `.next/server`): none of `V1_API_KEY`, `RAILWAY_BUCKET_*` credentials, `RESEND_API_KEY` or `RAILWAY_API_TOKEN` appear anywhere.
- **Finding:** `.env` was committed from `5c22f5a` (2026-03-29) until it was removed in `9c312f5` (2026-05-06, "remove committed .env"). The history is public. It held only local-dev values: a `localhost` `DATABASE_URL`, `NEXTAUTH_URL=http://localhost:3000`, and a human-phrase `NEXTAUTH_SECRET`/`AUTH_SECRET` that is **still the current local dev secret**. No cloud credentials were in it. The production `AUTH_SECRET` must differ from it, or anyone can forge session cookies. Since that couldn't be checked from Claude Code, the production secret gets rotated (see SECH-112). **Never reuse the local `.env` `AUTH_SECRET` anywhere else.**
- **Client bundle exposure:** the code has no `NEXT_PUBLIC_*` variables, no `env:` block in `next.config.mjs`, and no `"use client"` file reads `process.env` (other than `NODE_ENV`), so no server secret can be inlined into browser JS. Adding a `NEXT_PUBLIC_` variable means reviewing that it isn't secret.
