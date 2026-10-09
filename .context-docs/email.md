# Email sending (Resend + React Email)

Email templates live in `src/emails/`. The send helper is `sendOrgInviteEmail()` in `src/lib/invites.ts`.

**Resend client must be instantiated lazily** — `new Resend(process.env.RESEND_API_KEY)` at module level throws during Next.js static page data collection in CI (where the env var is absent), crashing the build. Always instantiate inside the function that uses it, not at module top level.

**`react:` option in `resend.emails.send()` fails at runtime** ("render is not a function") even though TypeScript accepts it. Always render manually first and pass the result as `html:`:
```ts
import { render } from "@react-email/components";
const html = await render(MyEmail({ ...props }));
await resend.emails.send({ ..., html });
```

Sending domain `jedforge.com` is verified with Resend. From address: `invites@jedforge.com` for invites, `security@jedforge.com` for password resets (JFR-183) — the specific mailbox does not need to exist.

**The local `.env` carries a real `RESEND_API_KEY`**, so any code path that sends mail sends it for real from `npm run dev` — including to made-up seeded addresses like `member@jedforge.dev`. Integration tests fake the `resend` module; a browser test of a mail-sending flow does not. See `password-reset.md` for how JFR-183 was hand-tested without sending.
