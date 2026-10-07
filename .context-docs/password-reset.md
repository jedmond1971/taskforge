# Password reset (JFR-183)

`/forgot-password` → emailed link → `/reset-password/<token>`. Public (no session), self-authenticating by the token.

## Token lifecycle
- `PasswordResetToken` (`prisma/schema.prisma`): `userId`, `tokenHash` (unique), `expiresAt`. **Only the sha256 is stored**; the raw 256-bit token (`randomBytes(32).toString("base64url")`) exists only in the email. A DB read can't be turned into takeovers.
- `issuePasswordResetToken` (`src/lib/password-reset.ts`): one live token per user — a new request deletes the old one (only the newest link works) — and it sweeps expired rows of every user, since nothing else deletes them. Expiry `PASSWORD_RESET_EXPIRY_MINUTES = 60`.
- **Using it deletes the row, and that delete is the atomic claim** (`deleteMany(...).count === 1` inside the transaction that updates the user), so two simultaneous submissions can't both succeed. Single-use, no `usedAt` column.
- Also deleted when the password changes another way (`changePassword`, `adminResetUserPassword`) so an old emailed link can't overwrite the new password, and by `ON DELETE CASCADE` with the user.

## No account enumeration
- `requestPasswordReset` returns the same message for a registered and an unregistered address. Every limit is keyed on what was typed (IP, `sha256(email)`), never on whether an account exists, so being throttled reveals nothing. Malformed input is the only distinct error.
- Everything that depends on the account existing — lookup, token, email — runs in `after()` (`next/server`), i.e. after the response, so response time isn't an oracle either. Don't "simplify" it back inline.
- The `auth.password_reset_requested` security event is emitted only when the account exists. It's a log line for owners, invisible to the requester.
- The reset page checks the token on render (to say "expired" instead of showing a form that can only fail). No limiter needed: 256-bit tokens can't be enumerated.

## Completing a reset (`resetPassword`)
Order matters: limits → token lookup (bad token → IP failure counted, generic "invalid or has expired") → **password policy** (8–128 chars, `src/lib/password-policy.ts`) → bcrypt → transaction (claim token, set hash, `sessionVersion + 1`, delete the user's other tokens) → `session.invalidated` event (`trigger: "password_reset"`) → `revokeOAuthTokensForUser`. A too-short password is refused *before* the claim, so a typo doesn't burn the link. It does **not** sign anyone in; every existing session is invalidated.

## Limits (`LIMITS` in `src/lib/rate-limit.ts`, table in `rate-limiting.md`)
Requests: 10/hour per IP and 3/hour per email (attempts mode — each can send mail). Completing: 10 failures/15 min per IP, 10 attempts/15 min per token. The per-email request cap is also what stops the form being used to flood one inbox.

## Email
`sendPasswordResetEmail` → Resend, from `JedForge <security@jedforge.com>` (verified domain; the mailbox needn't exist), template `src/emails/PasswordResetEmail.tsx`. Lazy `new Resend` and render-then-`html:` per `email.md`. A failed send logs via `logError` and deletes the unusable token (so a token row surviving a request means Resend *accepted* the message). **The local `.env` has a real `RESEND_API_KEY`, so requesting a reset for any existing local user — including the seeded `@jedforge.dev` ones — sends a real email through Resend** (found 2026-10-07 when a browser test did exactly that to a made-up address). For hand-testing the forgot form use an address that doesn't exist (nothing is sent) and seed tokens directly for the reset page; never request a reset for a seeded user unless you mean to send mail.

## Testing it locally
- Integration: `src/integration/password-reset.itest.ts` (fakes only Resend, reads the link back from the "sent" email; `after()` is faked in `setup.ts` and flushed with `flushAfter()`).
- By hand: tokens are hashed and the local key really sends (see Email), so seed one yourself — insert a `User` (bcrypt hash) and a `PasswordResetToken` whose `tokenHash` is `sha256(<raw>)`, then open `/reset-password/<raw>`.
- **After the migration, restart `next dev`** — a running server keeps the old Prisma client and the reset page 500s with `Cannot read properties of undefined (reading 'findUnique')` (plus a misleading "script tag" overlay message).

## Not done / follow-ups
- No "your password was changed" confirmation email.
- Login page itself shows no "password reset" banner after a successful reset (the success state links to `/login`).
- The real email delivery is verified only in production, by requesting a reset for an account you own.
