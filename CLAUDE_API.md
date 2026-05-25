# JedForge Internal REST API

This is an internal API used by Claude Code to create, read, update, and delete issues in JedForge during development sessions. No authentication is required.

## Base URLs

| Environment | URL |
|---|---|
| Local dev | `http://localhost:3000/api/v1` |
| Production | `https://jedforge.com/api/v1` |

---

## Routes

### GET /api/v1/projects

List all non-archived projects with their statuses.

**Response 200:**
```json
{
  "projects": [
    {
      "id": "cuid",
      "name": "TaskForge",
      "key": "TF",
      "statuses": [
        { "id": "TODO", "name": "To Do", "order": 0 },
        { "id": "IN_PROGRESS", "name": "In Progress", "order": 1 },
        { "id": "IN_REVIEW", "name": "In Review", "order": 2 },
        { "id": "DONE", "name": "Done", "order": 3 }
      ]
    }
  ]
}
```

---

### GET /api/v1/projects/:id

Get a single project by its database ID, including statuses and members.

**Response 200:**
```json
{
  "id": "cuid",
  "name": "TaskForge",
  "key": "TF",
  "description": "...",
  "statuses": [ ... ],
  "members": [
    {
      "id": "membership-cuid",
      "role": "PROJECT_LEAD",
      "user": { "id": "cuid", "name": "Jamie", "email": "...", "avatarUrl": null }
    }
  ]
}
```

**Response 404:** `{ "error": "Project not found" }`

---

### GET /api/v1/issues

List issues with optional filters.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `projectId` | string | Filter by project database ID |
| `status` | string | Filter by status name or enum value (see Status Values below) |
| `assigneeId` | string | Filter by assignee user ID |
| `limit` | number | Max results (default 50, max 100) |
| `offset` | number | Pagination offset (default 0) |

**Response 200:**
```json
{
  "issues": [ ...issue objects ],
  "total": 120,
  "limit": 50,
  "offset": 0
}
```

---

### POST /api/v1/issues

Create a new issue.

**Request body:**
```json
{
  "projectId": "cuid (required)",
  "title": "string (required)",
  "description": "string (optional, markdown supported)",
  "statusId": "TODO | IN_PROGRESS | IN_REVIEW | DONE (optional, default: TODO)",
  "priority": "LOW | MEDIUM | HIGH | CRITICAL | URGENT (optional, default: MEDIUM)",
  "assigneeId": "user cuid (optional)",
  "reporterId": "user cuid (optional — defaults to first project member)"
}
```

**Response 201:**
```json
{
  "key": "TF-43",
  "id": "cuid",
  "title": "...",
  "status": { "id": "TODO", "name": "To Do" },
  "priority": "MEDIUM",
  "projectId": "cuid",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Response 400:** `{ "error": "..." }` (missing required fields, invalid values, assignee not in project)

**Response 404:** `{ "error": "Project not found" }`

---

### GET /api/v1/issues/:key

Get a single issue by its key (e.g. `TF-42`). Key lookup is case-insensitive.

**Response 200:**
```json
{
  "id": "cuid",
  "key": "TF-42",
  "title": "...",
  "description": "...",
  "status": { "id": "IN_PROGRESS", "name": "In Progress" },
  "priority": "HIGH",
  "projectId": "cuid",
  "projectName": "TaskForge",
  "assigneeId": "cuid or null",
  "assignee": { "id": "cuid", "name": "Jamie" },
  "reporterId": "cuid",
  "reporter": { "id": "cuid", "name": "Maximus" },
  "commentsCount": 3,
  "attachmentsCount": 0,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Response 404:** `{ "error": "Issue not found" }`

---

### PATCH /api/v1/issues/:key

Update an issue. All fields are optional; only provided fields are changed.

**Request body:**
```json
{
  "title": "string",
  "description": "string or null",
  "statusId": "TODO | IN_PROGRESS | IN_REVIEW | DONE",
  "priority": "LOW | MEDIUM | HIGH | CRITICAL | URGENT",
  "assigneeId": "user cuid or null"
}
```

**Response 200:** Full updated issue object (same shape as GET /api/v1/issues/:key).

**Response 400:** `{ "error": "..." }` (invalid values, no fields provided, assignee not in project)

**Response 404:** `{ "error": "Issue not found" }`

---

### DELETE /api/v1/issues/:key

Delete an issue permanently.

**Response 200:**
```json
{ "deleted": true, "key": "TF-43" }
```

**Response 404:** `{ "error": "Issue not found" }`

---

## Status Values

Statuses are enum values. Both enum names and human-readable names are accepted in filter/request params:

| Enum value | Human-readable |
|---|---|
| `TODO` | `To Do` |
| `IN_PROGRESS` | `In Progress` |
| `IN_REVIEW` | `In Review` |
| `DONE` | `Done` |

---

## Priority Values

| Value | Notes |
|---|---|
| `LOW` | |
| `MEDIUM` | Default |
| `HIGH` | |
| `CRITICAL` | Most severe |
| `URGENT` | Alias for `CRITICAL` |

---

## Working Convention for Claude Code

This API exists so Claude Code can track its own development work inside JedForge in
real time. The following rules apply to every Claude Code session, without exception.

### When to create an issue

Create an issue at the START of any non-trivial task:
- Before implementing a new feature or enhancement
- Before making structural changes to the codebase (routing, schema, auth, etc.)
- Before a bug fix that requires more than one file change
- Before any work session on JedForge itself

Issue title format: short, imperative, describing the goal.
  Good: "Add SSE support to activity feed"
  Bad:  "Working on activity feed stuff"

### Choosing the right project

Use GET /api/v1/projects to list available projects. Choose based on what is being worked
on. When working on JedForge/TaskForge itself, use the JedForge/TaskForge project. When
working on another codebase, use or create a project that matches.

### Status progression

Move issues through statuses as work progresses:
- Create in "To Do" (or the project's first status)
- Move to "In Progress" when work begins
- Move to "In Review" or "Done" when complete
- If work is abandoned or blocked, update status and add a description note explaining why

### Description field

Use the description field to document:
- What the task involves
- Any key decisions made during implementation
- Files changed (brief summary, not exhaustive)
- Any follow-up issues to create

Markdown is supported. Be concise but informative.

### Priority

- URGENT: production is broken or a deploy is blocked
- HIGH: core feature work, significant refactors
- MEDIUM: standard enhancements (default)
- LOW: minor polish, documentation, cleanup

### Self-referential work

When building or improving the JedForge API itself (this file's subject), always create an
issue in the JedForge project before starting and update it at each major milestone.
