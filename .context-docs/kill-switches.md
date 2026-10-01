# Kill switches (SECH-118)

Three independent env-var switches let the owner contain an OAuth/MCP, upload or external-API flaw without a code change. All default **on** (unset = current behaviour); setting one to `false` makes the surface answer **503** `{"error":"This feature is temporarily disabled.","code":"feature_disabled"}` with `Retry-After: 300` and `Cache-Control: no-store`.

| Variable | Surface blocked when off |
|---|---|
| `OAUTH_MCP_ENABLED` | `/api/oauth/*`, `/api/mcp`, `/.well-known/*` (discovery metadata), `/oauth/authorize` (consent page + its server action) |
| `EXTERNAL_API_ENABLED` | everything under `/api/external/*` |
| `UPLOADS_ENABLED` | writes (POST/PUT/PATCH) to `/api/attachments/{presign,upload,confirm}`, `/api/avatar`, `/api/editor-images`, `/api/docs/<key>/pages/<id>/file` |

`AI_CHAT_ENABLED` is separate (default **off**, Jamie-only — see CLAUDE.md "Security constraints").

**Off values** (case-insensitive, trimmed): `false`, `0`, `off`, `no`, `disabled`. Anything else, including unset, is on. This is deliberately lenient so a typo during an incident can't leave a surface open.

**Uploads-off keeps reads and deletes working** — existing attachments, avatars and images still display, and attachments can still be deleted; only new bytes into storage are refused.

## How it works

`src/lib/kill-switches.ts` maps (path, method) → switch; `src/middleware.ts` calls `blockedBySwitch()` first, before the auth redirect and before any handler, so a blocked request has no side effects (no DB write, no S3 write, no token minted). The module imports nothing (Edge runtime).

Verified 2026-10-01 on a production build (`next build` with no flags, then `next start` with them set): every listed surface returned 503 and `GET /api/avatar` still returned 401 (auth, not a switch). So the variable is read at **runtime**, not inlined at build time.

## Flipping one in Railway

1. Railway dashboard → project → TaskForge service → Variables → set e.g. `UPLOADS_ENABLED=false`.
2. Railway redeploys on a variable change (~2–3 min, same lag as a code deploy — see CLAUDE.md "Railway deploy lag"). There is no hot reload; the old deployment keeps serving until the new one swaps in.
3. Confirm: `curl -si -X POST https://www.jedforge.com/api/attachments/presign | head -1` → `503`.
4. To restore, delete the variable or set it to `true` and let it redeploy.

Staging does not exist yet (SECH-110); once it does, rehearse a flip there first and record the time-to-effect here.

## UI behaviour when off

No buttons are hidden. Upload UIs fail into a `sonner` toast: the attachments panel shows the server's message ("This feature is temporarily disabled."); avatar, editor-image and doc-file uploads show their generic failure text. MCP/OAuth clients see the 503 JSON.

## Adding a new surface

`kill-switches.test.ts` scans `src/app/api`: a route that calls `putObject`/`getPresignedUploadUrl`, or any new route under `/api/external`, `/api/oauth` or `/api/mcp`, fails the test until `KILL_SWITCH_RULES` covers it. Add the rule, don't add an exception.
