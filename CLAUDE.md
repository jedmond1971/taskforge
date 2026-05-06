# TaskForge / JedForge — Codebase Notes

## Organization tenancy invariants

Every project belongs to exactly one organization, and every user-to-project relationship must be valid inside that organization. This is a core product invariant — JedForge is a multi-tenant product where each client organization experiences the app as its own instance.

**Rules enforced in code:**

1. **Registration** (`src/app/api/auth/register/route.ts`) — Creating a `User` also creates a default `Organization` and an OWNER `OrgMember` in the same transaction. A registered user must always have an org before they can sign in and create projects.

2. **Project member search** (`searchUsers`) — Only returns users who are `OrgMember`s of the project's org and are not already project members. Users from other orgs are never surfaced.

3. **Adding a project member** (`addProjectMember`) — Validates that the target user has an `OrgMember` row for the project's org before creating the `ProjectMember`.

4. **Creating a user from project settings** (`createUserAndAddToProject`) — Creates `User`, `OrgMember` (for the project's org), and `ProjectMember` in one transaction.

5. **Issue assignees** (`createIssue`, `updateIssue`) — If `assigneeId` is non-null, the assignee must have a `ProjectMember` row for the same project. Null/unassigned is always allowed.

6. **Admin org deletion** (`adminDeleteOrg`) — Blocked with a clear error if the org has any projects. Does not cascade-delete projects silently.

**Non-goals (do not implement without a separate product decision):**
- Org switching UI
- Full invite system
- Billing/subscription changes
- Broad project membership role redesign
- Cascading project deletion on org delete
