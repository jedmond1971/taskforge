# External REST API

Customer-facing API at `/api/external/v1/`. Uses org-scoped API keys — entirely separate from the internal `/api/v1/` shared-secret API.

- **Auth guard**: `requireExternalApiKey(request)` from `src/lib/external-api-auth.ts`. Returns `ExternalApiContext = { orgId, apiKeyId, createdById }` on success or a `NextResponse` (401/429) on failure. Every handler must open with `const ctx = await requireExternalApiKey(request); if (ctx instanceof NextResponse) return ctx;`.
- **Org isolation**: every query must be scoped by `ctx.orgId`. Use `requireProjectInOrg(projectKey, orgId)` from `src/app/api/external/v1/_helpers.ts` for project lookups — it adds `orgId` and `isClosed: false` filters automatically. Never look up a project by key alone.
- **Implicit authorship**: `ctx.createdById` is the user who created the API key. Use it as `reporterId` for new issues and `authorId` for comments. Do not accept a caller-supplied `authorId` — that would allow impersonation.
- **Comment body**: `normalizeBody()` in `_helpers.ts` accepts plain text (wraps in `<p>`) or TipTap HTML (sanitizes). Use it instead of calling `sanitizeTipTapHtml` directly on external comment routes.
- **Shared helpers**: `src/app/api/external/v1/_helpers.ts` re-exports `resolveStatusForProject`, `PRIORITY_MAP`, `formatIssue` from the v1 helpers and adds `requireProjectInOrg`, `formatComment`, `formatProject`, `normalizeBody`, `ISSUE_INCLUDE`, `TYPE_MAP`.
- **Rate limiting**: in-memory fixed window (100 req/min per `apiKeyId`) in `external-api-auth.ts`. Resets on redeploy. Not distributed — would over-count on multiple Railway instances.
- **Key management UI**: `/org-settings` (`src/app/(dashboard)/org-settings/page.tsx`), gated to org ADMIN/OWNER via `canManageApiKeys()`. Accessible from the sidebar user-dropdown "Org Settings" link.
