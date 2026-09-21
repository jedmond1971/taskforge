# Authorization matrix (SECH-85)

Every externally reachable route handler and server action, with how it authenticates, where its tenant boundary comes from, and the minimum role. **Server actions are public POST endpoints for any logged-in user** — the client does not have to go through the UI, so each one must enforce tenancy itself.

`src/__tests__/authz-matrix.test.ts` fails CI if a `route.ts` handler or an exported server action is missing from this file, so add a row when you add one. Behaviour is verified by the DB-backed suite in `src/integration/` (`npm run test:integration`).

## Auth mechanisms

| Mechanism | Guard | Credential | Tenant binding |
|---|---|---|---|
| Session | `auth()` / `requireUser()` in `src/lib/auth.ts` (fail-closed on invalidated sessions, SECH-86) + `requireProjectRole` / `requireOrgRole` in `src/lib/permissions.ts` | NextAuth JWT cookie | user's `ProjectMember` / `OrgMember` rows; platform `UserRole.ADMIN` bypasses membership (cross-tenant by design) |
| External API key | `requireExternalApiKey` (`src/lib/external-api-auth.ts`) | `X-Api-Key`, org-scoped, sha256-hashed, revocable | the key's `orgId`; projects via `requireProjectInOrg` |
| OAuth / MCP bearer | `requireOAuthToken` (`src/lib/oauth/require-oauth-token.ts`) | `Authorization: Bearer`, sha256-hashed, expiring, revocable | the token's `orgId` + `userId`; tools re-check `ProjectMember` |
| Internal v1 secret | `requireV1ApiKey` (`src/lib/v1-auth.ts`) | `X-Internal-Api-Key` shared secret | none — superuser; compromise of the secret is total access |
| Public | none | — | self-authenticating or inert (see rows) |

Roles: project `PROJECT_LEAD > TEAM_MEMBER > VIEWER`; org `OWNER / ADMIN / MEMBER`; platform `UserRole.ADMIN`. Group grants (`getUserGrants`) only ever *boost* a role the user already holds.

## API and metadata routes

| Route file (`src/app/…`) | Methods | Auth | Tenant scope | Minimum role | Notes |
|---|---|---|---|---|---|
| `api/ai/chat/route.ts` | POST | session (`auth()`, fail-closed on invalidated) + `AI_CHAT_ENABLED` flag | issue -> project (`requireProjectRole`) | project member (`canViewProject`) | 404 when flag off; conversation keyed to caller's own userId |
| `api/ai/conversations/route.ts` | GET | session (`auth()`, fail-closed on invalidated) + `AI_CHAT_ENABLED` flag | issue -> project (`requireProjectRole`) | project member | only the caller's own conversation |
| `api/attachments/[id]/route.ts` | DELETE | session (`auth()`, fail-closed on invalidated) | attachment -> issue -> project membership | uploader (must still be a member) or PROJECT_LEAD | deletes S3 object + row |
| `api/attachments/[id]/url/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | attachment -> issue -> project membership | any project member |  |
| `api/attachments/confirm/route.ts` | POST | session (`auth()`, fail-closed on invalidated) | issue -> project membership; `fileKey` must start `attachments/{issueId}/` | PROJECT_LEAD or TEAM_MEMBER (hard-coded, ignores group grants — SECH-96) | size re-checked via HEAD, org quota, image validated |
| `api/attachments/presign/route.ts` | POST | session (`auth()`, fail-closed on invalidated) | issue -> project membership; key generated server-side | PROJECT_LEAD or TEAM_MEMBER (hard-coded — SECH-96) | MIME allowlist, size cap, org quota |
| `api/attachments/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | issue -> project membership | any project member | returns presigned download URLs for that issue only |
| `api/attachments/upload/route.ts` | POST | session (`auth()`, fail-closed on invalidated) | issue -> project membership | PROJECT_LEAD or TEAM_MEMBER (hard-coded — SECH-96) | MIME allowlist, size cap, org quota, sharp image validation |
| `api/auth/[...nextauth]/route.ts` | GET, POST | public (NextAuth handlers) | n/a | n/a | login is rate-limited per ip+email |
| `api/auth/register/route.ts` | POST | public (inert stub) | n/a | n/a | registration disabled; always 403 |
| `api/avatar/route.ts` | GET, PUT | session (`auth()`, fail-closed on invalidated) | GET: any `avatars/` key (not tenant-scoped, accepted); PUT: caller's own userId key | any authenticated user | PUT re-encodes to 256px JPEG via sharp |
| `api/csp-report/route.ts` | POST | public by design (browsers POST reports) | n/a | n/a | SECH-84: 8 KB cap, per-IP in-memory quota, logs origin+path only, nothing persisted |
| `api/docs/[projectKey]/pages/[pageId]/file/route.ts` | GET, POST | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx`; page by `{id, docSpaceId}` | GET: member / public; POST: `canEditIssues` | type/size allowlist, org quota; GET returns presigned URL |
| `api/docs/[projectKey]/pages/[pageId]/images/[imageKey]/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx`; key must start with the page's `docx-images/` prefix and contain no `..` | member / public | streams bytes through the app; never a raw S3 URL |
| `api/docs/[projectKey]/pages/[pageId]/links/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | project membership by key -> docspace -> page | any project member | read-only list of linked issues |
| `api/docs/[projectKey]/pages/[pageId]/revisions/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | project membership by key -> docspace -> page | any project member | read-only |
| `api/docs/[projectKey]/pages/[pageId]/route.ts` | GET, PATCH, DELETE | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx`; page looked up by `{id, docSpaceId}` | GET: member / public; PATCH: `canEditIssues`; DELETE: `canManageProject` | PATCH `sectionId` verified against the page's docspace (SECH-85 fix); content sanitized + revision snapshot (cap 50) |
| `api/docs/[projectKey]/pages/route.ts` | GET, POST | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx` (docspace of that project) | GET: member / public; POST: `canEditIssues` (+grants) | POST sanitizes content (SECH-85 fix); `sectionId` verified to be in this docspace |
| `api/docs/[projectKey]/route.ts` | GET, PATCH | session (`auth()`, fail-closed on invalidated) | project via `resolveDocCtx` (member, or public docspace); PATCH looks up membership by key | GET: member, or any authed user if `isPublic` (SECH-95); PATCH: PROJECT_LEAD | PATCH toggles `isPublic` |
| `api/docs/[projectKey]/search/route.ts` | GET | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx`; query scoped to that docspace | member / public | max 20 results |
| `api/docs/[projectKey]/sections/[sectionId]/route.ts` | PATCH, DELETE | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx`; section by `{id, docSpaceId}` | PATCH: `canEditIssues`; DELETE: `canManageProject` | DELETE also removes S3 files of DOCUMENT pages |
| `api/docs/[projectKey]/sections/route.ts` | GET, POST | session (`auth()`, fail-closed on invalidated) | `resolveDocCtx` | GET: member / public; POST: `canEditIssues` |  |
| `api/editor-images/route.ts` | GET, POST | session (`auth()`, fail-closed on invalidated) | none — `editor-images/{uuid}` keys, unguessable but not tenant-checked (accepted risk, SECH-95) | any authenticated user | POST validates with sharp; GET 302s to a presigned URL |
| `api/external/v1/projects/[key]/issues/[issueKey]/comments/route.ts` | GET, POST | external org API key | `requireProjectInOrg` + issue by `{key, projectId}` | org-wide | author forced to key's `createdById` (no impersonation); body sanitized |
| `api/external/v1/projects/[key]/issues/[issueKey]/route.ts` | GET, PATCH | external org API key | `requireProjectInOrg` + issue by `{key, projectId}` | org-wide | explicit field whitelist |
| `api/external/v1/projects/[key]/issues/route.ts` | GET, POST | external org API key | `requireProjectInOrg`; assignee must be a project member | org-wide | reporter forced to key's `createdById`; description sanitized |
| `api/external/v1/projects/[key]/route.ts` | GET | external org API key | `requireProjectInOrg(key, orgId)` | org-wide | 404 for other orgs and closed projects |
| `api/external/v1/projects/route.ts` | GET | external org API key (`X-Api-Key`) | key's `orgId` | org-wide | excludes closed projects |
| `api/internal/cleanup-orphaned-attachments/route.ts` | POST | internal v1 secret (`X-Internal-Api-Key`) | global (storage housekeeping) | shared secret | called by the daily GitHub Actions cron |
| `api/issues/[issueId]/route.ts` | PATCH, DELETE | session (`auth()`, fail-closed on invalidated) | issue -> project membership | `canEditIssues` (+grants) | PATCH field whitelist; assignee must be a project member |
| `api/mcp/route.ts` | GET, POST, DELETE | OAuth bearer (`requireOAuthToken`) | token's `orgId`; every tool re-resolves project/issue scoped to that org + requires `ProjectMember` | per-tool scope; writes need `canEditIssues` | closed projects excluded (docs exempt); stateless transport per request |
| `api/oauth/register/route.ts` | POST | public (RFC 7591 dynamic client registration) | n/a | n/a | spec-required to be public |
| `api/oauth/token/route.ts` | POST | public; self-authenticates via PKCE / client credentials / refresh token | code/token bound to one org + user | n/a | PKCE S256 only; codes single-use; refresh tokens rotate |
| `api/projects/route.ts` | POST | session (`auth()`, fail-closed on invalidated) | `session.user.orgId` + `OrgMember` re-check; client `orgId` ignored | any org member | creator becomes PROJECT_LEAD; project keys are globally unique |
| `api/session-invalidated/route.ts` | GET | public by design (SECH-86) | n/a | n/a | clears the cookie of an absent/invalidated session, redirects a valid one to `/` |
| `api/v1/issues/[key]/comments/[commentId]/route.ts` | PATCH, DELETE | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `api/v1/issues/[key]/comments/route.ts` | GET, POST | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `api/v1/issues/[key]/route.ts` | GET, PATCH, DELETE | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `api/v1/issues/route.ts` | GET, POST | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `api/v1/projects/[id]/route.ts` | GET | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `api/v1/projects/route.ts` | GET | internal v1 secret (`X-Internal-Api-Key`) | none — superuser by design | shared secret | constant-time compare, DB-backed failure rate limit; explicit field handling |
| `well-known/oauth-authorization-server/route.ts` | GET | public metadata (RFC 8414) | n/a | n/a | reached via the `/.well-known` rewrite |
| `well-known/oauth-protected-resource/route.ts` | GET | public metadata (RFC 9728) | n/a | n/a | reached via the `/.well-known` rewrite |

## Server actions

### `(auth)/invite/[token]/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `acceptInviteNewUser` | public — possession of the invite token | invite email/org/role from the invite; existing account blocked | invitee |
| `acceptInviteExistingUser` | `auth()` + session email must equal the invite email | invite row by `token` | invitee |

### `(auth)/oauth/authorize/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `denyAuthorization` | none (redirect only) | redirects only to a registered `redirect_uri` | n/a |
| `approveAuthorization` | `auth()` | `validateAuthorizeRequest`; caller must be an `OrgMember` of the chosen org | any org member |

### `(dashboard)/admin/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getAdminUsers` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminCreateUser` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminUpdateUser` | local `requireAdmin()` | target user id | platform ADMIN; role change bumps `sessionVersion` |
| `adminResetUserPassword` | local `requireAdmin()` | target user id | platform ADMIN; bumps `sessionVersion` |
| `adminAddUserToProject` | local `requireAdmin()` | upserts `OrgMember` first (tenancy invariant 8) | platform ADMIN |
| `adminGetProjectsForSelect` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminDeleteUser` | local `requireAdmin()` | target user id | platform ADMIN; pre-flights every ON DELETE RESTRICT relation (owned orgs, issues reported, attachments, doc pages/revisions, links, invites, API keys) and refuses with a message |
| `getAdminProjects` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `getAdminProjectDetail` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `getAdminOrgs` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `getAdminOrgMembers` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `getAdminOrgDetail` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminCreateOrg` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminAddOrgMember` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminRemoveOrgMember` | local `requireAdmin()` | org id + user id | platform ADMIN; blocked while the user has ProjectMember rows in that org |
| `adminDeleteOrg` | local `requireAdmin()` | org id | platform ADMIN; blocked if the org has projects |
| `adminDeleteProject` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `closeProject` | local `requireAdmin()` | project id | platform ADMIN |
| `reopenProject` | local `requireAdmin()` | project id | platform ADMIN |
| `getAdminInvites` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminGetOrgsForSelect` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminCreateInvite` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminResendInvite` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `adminRevokeInvite` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |
| `getAdminAuditLog` | local `requireAdmin()` (`getCurrentUser` + `UserRole.ADMIN`) | none — platform ADMIN acts across all orgs by design | platform ADMIN |

### `(dashboard)/notifications/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getNotifications` | `auth()` | own `userId` in every query | any authenticated user |
| `getUnreadCount` | `auth()` | own `userId` in every query | any authenticated user |
| `markNotificationRead` | `auth()` | own `userId` in every query | any authenticated user |
| `markAllNotificationsRead` | `auth()` | own `userId` in every query | any authenticated user |

### `(dashboard)/org-settings/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `listApiKeys` | `requireOrgRole(orgId, canManageApiKeys)` | client `orgId` verified against `OrgMember`; ids scoped `{id, orgId}` | org OWNER/ADMIN or `ORG_MANAGE_API_KEYS` grant |
| `createApiKey` | `requireOrgRole(orgId, canManageApiKeys)` | client `orgId` verified against `OrgMember`; ids scoped `{id, orgId}` | org OWNER/ADMIN or `ORG_MANAGE_API_KEYS` grant |
| `revokeApiKey` | `requireOrgRole(orgId, canManageApiKeys)` | client `orgId` verified against `OrgMember`; ids scoped `{id, orgId}` | org OWNER/ADMIN or `ORG_MANAGE_API_KEYS` grant |

### `(dashboard)/org-settings/group-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `listGroups` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `getOrgProjectsForGroups` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `searchOrgMembersForGroup` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `createGroup` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `renameGroup` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `deleteGroup` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `addGroupMember` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `removeGroupMember` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `setGroupPermission` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |
| `removeGroupPermission` | `requireOrgRole(orgId, canManageGroups)` | client `orgId` verified against `OrgMember`; group/grant ids scoped `{id, orgId}`; members and projects must be in the same org | org OWNER/ADMIN only (never grantable, invariant 10) |

### `(dashboard)/projects/[projectKey]/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `createIssue` | `requireProjectRole(canEditIssues)` | `statusId`, `parentId`, `assigneeId` each verified to belong to the project (SECH-85 fix) | TEAM_MEMBER+ |
| `updateIssue` | `requireProjectRole(canEditIssues)` | issue by `{id, projectId}`; `statusId` verified; only whitelisted fields written (SECH-85 fix — was a raw spread) | TEAM_MEMBER+ |
| `bulkUpdateIssueFields` | `requireProjectRole(canEditIssues)` | issues by `{id in, projectId}`, status + assignee verified | TEAM_MEMBER+ |
| `deleteIssue` | `requireProjectRole(canEditIssues)` | issue by `{id, projectId}` | TEAM_MEMBER+ |
| `getIssues` | `auth()` + inline `ProjectMember` check | project by key -> membership | any member |
| `getIssue` | `auth()` + inline `ProjectMember` check | project by key -> membership; issue by `{key, projectId}` | any member |
| `linkDocPage` | file-local `requireProjectMember` (membership only) | issue by `{id, projectId}`; page by `{id, docSpaceId}` | any member incl. VIEWER (SECH-96) |
| `unlinkDocPage` | file-local `requireProjectMember` (membership only) | issue by `{id, projectId}` | any member incl. VIEWER (SECH-96) |
| `searchIssuesForLinking` | file-local `requireProjectMember` (membership only) | issues scoped to project | any member |
| `linkIssue` | file-local `requireProjectMember` (membership only) | both issues by `{id, projectId}` | any member incl. VIEWER (SECH-96) |
| `unlinkIssue` | file-local `requireProjectMember` (membership only) | link by `{id, sourceIssue.projectId}` | any member incl. VIEWER (SECH-96) |
| `searchIssuesForParent` | file-local `requireProjectMember` (membership only) | issues scoped to project | any member |
| `setIssueParent` | `requireProjectRole(canEditIssues)` | issue and parent both by `{id, projectId}`; cycle check | TEAM_MEMBER+ |
| `getProjectStatuses` | `auth()` + inline `ProjectMember` check | project by key -> membership | any member (NB: board-actions.ts has a same-named lead-only variant) |
| `getProjectMembers` | `auth()` + inline `ProjectMember` check | project by key -> membership | any member |
| `moveIssue` | `requireProjectRole(canEditIssues)` | issue by `{id, projectId}`; target status scoped to project (SECH-85 fix) | TEAM_MEMBER+ |
| `reorderIssues` | `requireProjectRole(canEditIssues)` | `updateMany where {id, projectId}` | TEAM_MEMBER+ |
| `addComment` | file-local `requireProjectMember` (membership only) | issue by `{id, projectId}`; body sanitized | any member incl. VIEWER (by design) |
| `updateComment` | file-local `requireProjectMember` (membership only) | comment's issue must be in the project; body sanitized | comment author only |
| `deleteComment` | file-local `requireProjectMember` (membership only) | comment's issue must be in the project | comment author only |
| `updateProject` | `requireProjectRole(canEditSettings)` | only `name` / `description` written (SECH-85 fix — was a raw pass-through that allowed `orgId`) | PROJECT_LEAD (or `PROJECT_EDIT_SETTINGS` grant) |
| `deleteProject` | `requireProjectRole(canManageProject)` | project id from key; S3 cleanup | PROJECT_LEAD (or `PROJECT_DELETE` grant) |
| `addProjectMember` | `requireProjectRole(canManageMembers)` | target user must be an `OrgMember` of the project's org (invariant 3) | PROJECT_LEAD (or `PROJECT_MANAGE_MEMBERS` grant) |
| `removeProjectMember` | `requireProjectRole(canManageMembers)` | membership by `{id, projectId}`; leads protected | PROJECT_LEAD / grant |
| `changeMemberRole` | `requireProjectRole(canManageMembers)` | membership by `{id, projectId}`; leads protected | PROJECT_LEAD / grant (a grantee can promote themselves — by design, SECH-96) |
| `searchUsers` | `requireProjectRole(canManageMembers)` | only users in the project's org, excluding current members | PROJECT_LEAD / grant |
| `createUserAndAddToProject` | `requireProjectRole(canManageMembers)` | creates `User` + `OrgMember` + `ProjectMember` in one transaction (invariant 4) | PROJECT_LEAD / grant (no email normalisation / password policy — SECH-96) |
| `setProjectPrivacy` | `requireAdmin()` (permissions.ts) | project by key | platform ADMIN |
| `getIssuesHierarchy` | `auth()` + inline `ProjectMember` check | project by key -> membership | any member |

### `(dashboard)/projects/[projectKey]/issues/[issueKey]/custom-field-value-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getApplicableCustomFields` | `requireProjectRole(() => true)` | org + project scoped | any member |
| `getCustomFieldValues` | `requireProjectRole(() => true)` | issue by `{id, projectId}` | any member |
| `setCustomFieldValue` | `requireProjectRole(canEditIssues)` | issue by `{id, projectId}`; field's `orgId` must match and be applicable to the project | TEAM_MEMBER+ |

### `(dashboard)/projects/[projectKey]/settings/board-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getProjectStatuses` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `createProjectStatus` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `renameProjectStatus` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `deleteProjectStatus` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `getDoneAutoHideDays` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `updateDoneAutoHideDays` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |
| `reorderProjectStatuses` | `requireProjectRole(canManageProject)` | status by `{id, projectId}` | PROJECT_LEAD |

### `(dashboard)/projects/[projectKey]/settings/custom-field-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getCustomFields` | `requireOrgRole(orgId, canManageCustomFields)` | client `orgId` verified against `OrgMember`; field by `{id, orgId}`; restricted projects must be in the org | org OWNER/ADMIN or `ORG_MANAGE_CUSTOM_FIELDS` grant |
| `getOrgProjects` | `requireOrgRole(orgId, canManageCustomFields)` | client `orgId` verified against `OrgMember`; field by `{id, orgId}`; restricted projects must be in the org | org OWNER/ADMIN or `ORG_MANAGE_CUSTOM_FIELDS` grant |
| `createCustomField` | `requireOrgRole(orgId, canManageCustomFields)` | client `orgId` verified against `OrgMember`; field by `{id, orgId}`; restricted projects must be in the org | org OWNER/ADMIN or `ORG_MANAGE_CUSTOM_FIELDS` grant |
| `updateCustomField` | `requireOrgRole(orgId, canManageCustomFields)` | client `orgId` verified against `OrgMember`; field by `{id, orgId}`; restricted projects must be in the org | org OWNER/ADMIN or `ORG_MANAGE_CUSTOM_FIELDS` grant |
| `deleteCustomField` | `requireOrgRole(orgId, canManageCustomFields)` | client `orgId` verified against `OrgMember`; field by `{id, orgId}`; restricted projects must be in the org | org OWNER/ADMIN or `ORG_MANAGE_CUSTOM_FIELDS` grant |

### `(dashboard)/projects/[projectKey]/settings/custom-field-layout-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getProjectFieldLayout` | `requireProjectRole(canManageProject)` | fields by `{id in, orgId}` and applicable to the project | PROJECT_LEAD |
| `reorderProjectFieldLayout` | `requireProjectRole(canManageProject)` | fields by `{id in, orgId}` and applicable to the project | PROJECT_LEAD |

### `(dashboard)/projects/[projectKey]/sprint-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `createSprint` | `requireProjectRole(canManageSprint)` + SPRINT-mode check | sprint by `{id, projectId}` | PROJECT_LEAD (or `SPRINT_MANAGE` grant) |
| `startSprint` | `requireProjectRole(canManageSprint)` + SPRINT-mode check | sprint by `{id, projectId}` | PROJECT_LEAD (or `SPRINT_MANAGE` grant) |
| `completeSprint` | `requireProjectRole(canManageSprint)` + SPRINT-mode check | sprint by `{id, projectId}` | PROJECT_LEAD (or `SPRINT_MANAGE` grant) |
| `addIssueToSprint` | `requireProjectRole(canEditIssues)` + SPRINT-mode check | sprint and issue both by `{id, projectId}` | TEAM_MEMBER+ |
| `removeIssueFromSprint` | `requireProjectRole(canEditIssues)` | `updateMany where {id, projectId}` | TEAM_MEMBER+ |

### `(dashboard)/projects/closed-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `reopenProject` | `auth()` + `role === ADMIN` | project id from form | platform ADMIN |

### `(dashboard)/search/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `runQuery` | `auth()` | query executes only over the caller's `ProjectMember` project ids | any authenticated user |
| `getAutocompleteSuggestions` | `auth()` | query executes only over the caller's `ProjectMember` project ids | any authenticated user |

### `(dashboard)/search/filter-actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `getMyFilters` | `auth()` | `projectId` membership checked; update/delete require ownership (`userId`); only whitelisted fields written on update (SECH-85 fix) | owner; `isGlobal` needs platform ADMIN |
| `saveFilter` | `auth()` | `projectId` membership checked; update/delete require ownership (`userId`); only whitelisted fields written on update (SECH-85 fix) | owner; `isGlobal` needs platform ADMIN |
| `updateFilter` | `auth()` | `projectId` membership checked; update/delete require ownership (`userId`); only whitelisted fields written on update (SECH-85 fix) | owner; `isGlobal` needs platform ADMIN |
| `deleteFilter` | `auth()` | `projectId` membership checked; update/delete require ownership (`userId`); only whitelisted fields written on update (SECH-85 fix) | owner; `isGlobal` needs platform ADMIN |

### `(dashboard)/settings/actions.ts`

| Action | Guard | Tenant scope | Minimum role |
|---|---|---|---|
| `changePassword` | `auth()` | own user only | any authenticated user; bumps `sessionVersion` |

## Findings from the SECH-85 audit

Fixed (each has a regression test in `src/integration/` that fails on the old code):

- `updateIssue` spread client-supplied `updates` into Prisma — an editor could set `projectId` (move an issue into another org's project), `reporterId`, `key`, `parentId`.
- `updateProject` passed client `data` through — a project lead could set `orgId` (move the project to another tenant), `isPrivate`, `isClosed`, `key`, `workflowMode`.
- `updateFilter` passed client `updates` through — a user could set `userId` and plant a saved filter in someone else's list.
- `createIssue` / `updateIssue` / `moveIssue` accepted a `statusId` (and `createIssue` a `parentId`) from another project, leaking that status's name in the response and linking across tenants.
- `POST /api/docs/[projectKey]/pages` stored `content` unsanitized (stored XSS; the viewer does not sanitize and public docspaces are cross-org readable). `PATCH …/pages/[pageId]` accepted a `sectionId` from another docspace.
- `searchOrgMembersForGroup` did not verify the group belonged to the org; the docx image proxy now also rejects `..` keys; `adminDeleteUser` now pre-flights `ApiKey.createdById` (ON DELETE RESTRICT) instead of failing on the FK.

Open (tracked, not changed unilaterally):

- SECH-93 — closed projects are only a page-level redirect; session actions/routes still accept writes (external API and MCP already block them).
- SECH-94 — OAuth tokens and org API keys are not revoked when the owning user's password/role/membership changes.
- SECH-95 — public docspaces are readable by any authenticated user of any org; `editor-images` / `avatar` keys are unguessable but not tenant-checked.
- SECH-96 — RBAC inconsistencies (VIEWER can link issues/docs, attachment routes ignore group grants, duplicate `requireAdmin`, no email/password normalisation in `createUserAndAddToProject`).
- SECH-97 — run the integration suite in CI and extend coverage. SECH-98 — external security review before paid launch.

Also worth knowing: the external API and MCP keep working for an org key/token whose creator left the org until revoked (SECH-94), and `POST /api/projects` reveals whether a project key exists in *any* org (keys are globally unique).
