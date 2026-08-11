# Groups (additive RBAC layer) — JFR-102 Phase C

Groups let an org OWNER/ADMIN grant specific extra permissions to specific people, without changing their `OrgRole`/`ProjectMemberRole`. Schema: `Group`, `GroupMember`, `GroupPermission` (`prisma/schema.prisma`), managed via `src/app/(dashboard)/org-settings/group-actions.ts` and `GroupsSettings.tsx`.

**Design invariant — boost only, never access-granting.** A Group can only raise what a user can *do* somewhere they're already a `ProjectMember`/`OrgMember`. It can never make a project visible to, or usable by, someone who isn't already a member — see org-tenancy invariant #9 in CLAUDE.md. This is why none of the other 8 org-tenancy invariants needed to change when Groups was added.

**Permission enum** (`prisma/schema.prisma`) mirrors the pre-existing `canX(role)` checks in `src/lib/permissions.ts` one-for-one — no broader taxonomy was invented:
- `PROJECT_DELETE` → `canManageProject`
- `PROJECT_EDIT_SETTINGS` → `canEditSettings`
- `PROJECT_MANAGE_MEMBERS` → `canManageMembers`
- `ISSUE_EDIT` → `canEditIssues`
- `SPRINT_MANAGE` → `canManageSprint` (added JFR-105 — sprint create/start/complete; adding/removing issues to a sprint uses `ISSUE_EDIT`/`canEditIssues` instead, since that's routine issue editing not sprint lifecycle)
- `ORG_MANAGE_CUSTOM_FIELDS` → `canManageCustomFields` (org-wide only — `projectId` must be null)
- `ORG_MANAGE_API_KEYS` → `canManageApiKeys` (org-wide only)

**Adding a new `Permission` value is only partially type-checked** — `PERMISSION_LABELS: Record<Permission, string>` in `GroupsSettings.tsx` is exhaustive and `tsc` catches a missing entry there. But `PROJECT_SCOPED_PERMISSIONS`/`ORG_SCOPED_PERMISSIONS`, the plain `Permission[]` arrays that actually surface the permission as a grantable checkbox in the UI, are **not** exhaustiveness-checked — a value present in the enum and the label map but missing from these arrays compiles fine and just silently never appears as grantable. Update all three (enum, label map, the correct one of the two arrays) together when adding a permission — don't rely on `tsc` to catch the array.

`canViewProject`/`canComment` are unchanged (trivially always-true, nothing to grant). `canInviteOrgMembers` is pre-existing dead code (nothing calls it) and was left alone. `canManageGroups` (OWNER/ADMIN only) is deliberately **not** boostable by any grant — see invariant #10.

**Mechanism:** `getUserGrants(userId, orgId, projectId?)` in `src/lib/permissions.ts` queries `GroupPermission` for grants where `projectId` matches (or is `null`, meaning org-wide) via any `Group` the user belongs to in that org. `requireProjectRole`/`requireOrgRole` compute this automatically and pass it as a second argument to the `check` callback — every pre-existing call site (~20 files) passes a bare function reference (e.g. `requireProjectRole(projectKey, canManageMembers)`), and JS/TS allows a function with fewer declared parameters to be called with more, so **all of them compile and gained group-awareness with zero changes**.

**Postgres NULL-uniqueness gap:** `GroupPermission`'s `@@unique([groupId, permission, projectId])` does not stop two org-wide (`projectId: null`) grants of the same permission — Postgres treats each `NULL` as distinct in a unique index. `setGroupPermission` (`group-actions.ts`) does a `findFirst`-then-`create` to dedupe in application code instead.

## Phase 1 vs. Phase 2 (grant coverage boundary)

Not every `canX(role)` consumer goes through `requireProjectRole`/`requireOrgRole`. Phase 1 (shipped) covers:
- Every server action in `projects/[projectKey]/actions.ts`, `org-settings/actions.ts`, `custom-field-actions.ts`, `board-actions.ts` — all funnel through the two `require*Role` wrappers, so grants apply automatically.
- The issue-detail edit-button visibility (`issues/[issueKey]/page.tsx`) and the project-settings members-tab visibility/gate (`settings/page.tsx` + `ProjectSettings.tsx`'s `MembersTab`) — these call `canEditIssues`/`canManageMembers` directly, so grants were threaded through by hand at these two call sites.

**Phase 2 (shipped, JFR-121):** the docs module, `/api/issues/[issueId]/route.ts`, and the MCP server tool guards now compute grants too, closing the gap described in earlier revisions of this doc:
- `DocCtx` (`src/app/api/docs/_helpers.ts`) now carries `orgId` alongside `projectId`. The local `resolvePage`/`resolveSection` helpers in the 5 docs route files (`pages/route.ts`, `pages/[pageId]/route.ts`, `pages/[pageId]/file/route.ts`, `sections/route.ts`, `sections/[sectionId]/route.ts`) forward both fields, and each `canEditIssues`/`canManageProject` call site fetches `getUserGrants(userId, orgId, projectId)` first. The 3 UI pages under `projects/[projectKey]/docs/` (`page.tsx`, `layout.tsx`, `[pageId]/page.tsx`) do the same — they now select `orgId` on the project query and pass grants into the visibility checks.
- `/api/issues/[issueId]/route.ts` selects `project.orgId` alongside `project.id` and passes grants into both the `PATCH` and `DELETE` `canEditIssues` checks.
- `src/lib/mcp/server.ts`: `requireDocContext` now also returns `projectId`; all 3 call sites (`write_doc_page`, `update_issue`, `add_comment`) fetch `getUserGrants(ctx.userId, ctx.orgId, projectId)` before their `canEditIssues` check — `OAuthTokenContext.orgId` was already available, no new plumbing needed there.

No remaining `canX(role)` call sites in the app bypass grants as of JFR-121 — full coverage.
