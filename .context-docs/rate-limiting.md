# Rate limiting (SECH-82, SECH-108)

Durable limiter in `src/lib/rate-limit.ts`. It counts failures in the Postgres `RateLimitAttempt` table, so limits survive restarts and are shared across instances. Only failures are recorded, never successes.

| Surface | Key(s) | Limit |
|---|---|---|
| Credentials login (`auth.ts` → `checkLoginRateLimit` / `recordLoginFailure`) | `login:<ip>:<email>` **and** `login-account:<email>` | 5 / 15 min per ip+email; 20 / 15 min per account (any IP) |
| Internal v1 API (`v1-auth.ts`) | `v1api:<ip>` | 10 failures / 15 min → 429 + `Retry-After` |
| `/api/csp-report` | in-memory per-IP sampler (log-noise control only, not security) | — |
| External org API (`external-api-auth.ts`) | **still in-memory** per API key, 100/min. Resets on restart; moving it to the durable store is SECH-107 | — |

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
