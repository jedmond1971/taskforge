# Rate limiting (SECH-82, SECH-107, SECH-108)

Durable limiter in `src/lib/rate-limit.ts`, backed by the Postgres `RateLimitAttempt` table, so limits survive restarts and are shared across instances. There are two counting modes:

- **Failures** (`checkRateLimit` before the operation, `recordFailure` only when it fails). Used where legitimate use rarely fails: guessing, bad tokens, wrong passwords.
- **Attempts** (`consumeRateLimit`). Every allowed call is recorded. Used where each call creates something (OAuth clients, auth codes, API keys) or is itself the cost (external API). A throttled call isn't recorded.

Named limits live in `LIMITS` in `rate-limit.ts`. **Any new sensitive endpoint should pick one of these modes and add a `LIMITS` entry**, rather than rolling its own limiter.

| Surface | Key(s) | Mode | Limit | Throttled response |
|---|---|---|---|---|
| Credentials login (`auth.ts` → `checkLoginRateLimit` / `recordLoginFailure`) | `login:<ip>:<email>` **and** `login-account:<email>` | failures | 5 / 15 min per ip+email; 20 / 15 min per account (any IP) | generic "invalid email or password" |
| Internal v1 API (`v1-auth.ts`) | `v1api:<ip>` | failures | 10 / 15 min | 429 + `Retry-After` |
| `POST /api/oauth/register` | `oauth-register:<ip>` | attempts | 20 / hour (generous: Claude.ai registers from Anthropic's shared egress IPs) | 429 `temporarily_unavailable` + `Retry-After` |
| `POST /api/oauth/token` | `oauth-token:<ip>:<client_id>` **and** `oauth-token-ip:<ip>` | failures (any ≥400 response) | 20 / 15 min per ip+client; 50 / 15 min per IP (so rotating `client_id` can't dodge it) | 429 `temporarily_unavailable` + `Retry-After` |
| `approveAuthorization` (consent screen; mints codes) | `oauth-approve:<userId>` | attempts | 20 / 15 min | redirect to the client with `error=temporarily_unavailable` |
| `acceptInviteNewUser` (public) | `invite-ip:<ip>` (bad, expired or used token) **and** `invite-token:<sha256(token)[:32]>` | failures / attempts | 10 / 15 min per IP; 10 / 15 min per token (also caps bcrypt work) | "Too many attempts. Try again in N minutes." |
| `acceptInviteExistingUser` | `invite-user:<userId>` | attempts | 10 / 15 min | same message |
| `changePassword` | `pw-change:<userId>` (wrong current password) | failures | 5 / 15 min. Stops a hijacked session brute-forcing its way to an account takeover | same message |
| `createApiKey` | `apikey-create:<userId>:<orgId>` | attempts | 10 / hour | same message |
| External org API (`external-api-auth.ts`) | `extapi:<apiKeyId>` **and** `extapi-auth-ip:<ip>` (missing, unknown or revoked key) | attempts / failures | 100 / min per key; 20 / 15 min bad keys per IP | 429 + `Retry-After` |
| `/api/csp-report` | in-memory per-IP sampler (log-noise control only, not security) | — | — | 204 |

Raw invite tokens never go into a limiter key (they're bearer secrets); the key uses a truncated sha256.

## Monitor-only switch (rollback lever)

Setting `RATE_LIMIT_MODE=monitor` on the Railway service makes **every** limiter above (login and v1 included) keep counting but never block. A would-be block logs `[security] rate limit would block (monitor mode)` with only the key's scope prefix (no emails, IPs or tokens). Use it if a limit harms legitimate traffic, then fix the threshold and unset it. Unset is the default, and means enforce.

## Failure policy when the store is down

The limiter's store is the application's own Postgres database. If the store is unreachable, every one of these endpoints is already failing on its own queries, so the limiter adds no separate fail-open path: the request errors (fail-closed) exactly as it would without the limiter. The only non-database limiter is the csp-report sampler.

## Housekeeping

`recordFailure` deletes expired rows for the key it writes. On about 1% of writes it also prunes every row older than 24 hours, since keys that never recur (one-off IPs and tokens) would otherwise accumulate. No window is longer than an hour.

## Testing

`src/integration/rate-limits.itest.ts` drives each endpoint to its limit, asserts nothing is created while throttled, and recovers by ageing the rows. `setup.ts` clears `RateLimitAttempt` before every test and mocks `next/headers` so Server Actions see an IP; set it with `setClientIp()` from `./session`.

The account-only login bucket is also a lockout lever: anyone who knows an email can close that account's logins for up to 15 minutes by failing 20 times. It is loosened deliberately for that reason, and the user still sees the generic "invalid email or password".

## Client IP: `getClientIp()` takes the **leftmost** `X-Forwarded-For` hop

### Railway edge behaviour, verified against production 2026-09-22

The XFF header that reaches the app is `<real client IP>, <Railway-internal proxy hop>`:
- **The edge discards any client-supplied XFF** and writes the real client IP first, so the leftmost hop is not spoofable.
- **It then appends an internal proxy hop that changes on every request.**

Railway's docs and staff answers contradict each other (2024: "use rightmost, we append"; June 2026: "we strip… an additional hop may occur during internal forwarding"), so this was established empirically. The v1 limiter was the oracle, using keyless requests and no secrets:

1. **Leftmost keying (original code):** 11 requests with `X-Forwarded-For: 203.0.113.77` returned 401 ×10, then 429. After that, a different spoofed XFF, no XFF, and (via `www.jedforge.com`) a spoofed XFF and/or `X-Real-IP` all returned 429. One stable bucket, keyed on the real client IP, that spoofing couldn't escape.
2. **Rightmost keying (f795573, briefly deployed, then reverted):** 11+ consecutive failures from one machine all returned 401 and never 429. **Every request landed in a fresh bucket**, which disables the ip-based limits. Never key on the rightmost hop here.

`www.jedforge.com` goes directly to the Railway edge (`server: railway-hikari`, no Cloudflare).

### Re-verify after any proxy, CDN or domain change

Send 11 keyless requests to `/api/v1/projects`. The 11th must be 429, and a follow-up with a different spoofed `X-Forwarded-For` must also be 429. Three failure modes:
- **All 401:** the key rotates per request, so the limiter is dead.
- **The spoofed request gets 401:** leftmost has become spoofable.
- **Some other machine is also throttled:** the key is a shared proxy IP. A genuinely different source IP is needed for this check. Claude Code's `WebFetch` runs from the same machine and shares the bucket, so it proves nothing. What worked on 2026-09-22: a throwaway draft PR adding a one-step `on: pull_request` workflow that curls the endpoint from a GitHub runner, then closing it unmerged with `--delete-branch`. The runner got 401 while the dev machine got 429 at the same moment, so the bucket is per-client.

The test locks the tester's IP out of the v1 API for up to 15 minutes, which also blocks Claude Code's v1 calls from that machine. The JedForge MCP connector still works.

If Railway ever starts appending to a client-supplied XFF, leftmost becomes spoofable. The IP-independent `login-account:` bucket still caps login guessing at 20 per 15 minutes per account. If a CDN is ever put in front, take the IP from the CDN's client-IP header, restricted to its published ranges.
