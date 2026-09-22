# Rate limiting (SECH-82, SECH-108)

Durable limiter in `src/lib/rate-limit.ts`. It counts failures in the Postgres `RateLimitAttempt` table, so limits survive restarts and are shared across instances. Only failures are recorded, never successes.

| Surface | Key(s) | Limit |
|---|---|---|
| Credentials login (`auth.ts` → `checkLoginRateLimit` / `recordLoginFailure`) | `login:<ip>:<email>` **and** `login-account:<email>` | 5 / 15 min per ip+email; 20 / 15 min per account (any IP) |
| Internal v1 API (`v1-auth.ts`) | `v1api:<ip>` | 10 failures / 15 min → 429 + `Retry-After` |
| `/api/csp-report` | in-memory per-IP sampler (log-noise control only, not security) | — |
| External org API (`external-api-auth.ts`) | **still in-memory** per API key, 100/min. Resets on restart; moving it to the durable store is SECH-107 | — |

The account-only login bucket is also a lockout lever: anyone who knows an email can close that account's logins for up to 15 minutes by failing 20 times. It is loosened deliberately for that reason, and the user still sees the generic "invalid email or password".

## Client IP: `getClientIp()` takes the **rightmost** `X-Forwarded-For` hop

The rightmost hop is the one the nearest proxy (Railway's edge) appended, and a client can't forge it. The leftmost hop is whatever the client sent whenever a proxy appends instead of replacing.

### Railway edge behaviour, verified against production 2026-09-22

Railway's documentation and staff answers contradict each other. In 2024 staff said to use the rightmost XFF value because the edge appended. In June 2026 they said the edge strips XFF. A July 2026 user saw neither. So this was tested empirically, using the v1 limiter as the oracle, with keyless requests and no secrets:

1. 11 requests with `X-Forwarded-For: 203.0.113.77` returned 401 ×10, then 429.
2. The same request with `203.0.113.78`, with no XFF, and via `www.jedforge.com` with a spoofed XFF, a spoofed `X-Real-IP`, and both: **all 429**.

So on both the `*.up.railway.app` domain and `www.jedforge.com` (direct to the Railway edge, `server: railway-hikari`, no Cloudflare), the edge **overwrites** XFF with the real client IP, and a spoofed header does not open a fresh bucket. Leftmost equals rightmost today; rightmost stays correct if Railway reverts to appending.

To re-verify, run the same steps. They lock the tester's own IP out of the v1 API for up to 15 minutes, which also blocks Claude Code's v1 calls from that machine (the JedForge MCP connector still works).

**If a CDN or any second proxy is ever put in front of the app, revisit this.** The rightmost hop would become the CDN's IP, and every user behind one edge node would share a bucket. Take the IP from the CDN's own client-IP header, restricted to the CDN's published ranges.
