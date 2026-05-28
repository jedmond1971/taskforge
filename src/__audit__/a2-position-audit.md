# A2 Position Strategy Audit

## Issue.position

**Field type:** `Int @default(0)` (prisma/schema.prisma:146)

**Write locations:**

| File | Function | Mechanism | Transaction? |
|------|----------|-----------|-------------|
| `src/app/(dashboard)/projects/[projectKey]/actions.ts:74` | `createIssue` | Sets `position: issueCount` at creation | No |
| `src/app/(dashboard)/projects/[projectKey]/actions.ts:456-463` | `moveIssue` | Shifts dest column then updates moved issue | No (race condition) |
| `src/app/(dashboard)/projects/[projectKey]/actions.ts:474-478` | `moveIssue` | Compacts source column after cross-column move | Yes — `prisma.$transaction([...])` |
| `src/app/(dashboard)/projects/[projectKey]/actions.ts:503-510` | `reorderIssues` | Reassigns 0..N-1 to all issues in drop order | Yes — `prisma.$transaction([...])` |

**Drag-and-drop trigger:** `src/components/board/KanbanBoard.tsx:101-161`
- `handleDragEnd` dispatches to `moveIssue` (cross-column) or `reorderIssues` (within-column)
- Position type passed to `moveIssue.newPosition` is `overIndex` (0-based int) from dnd-kit

**Race condition:** `moveIssue`'s `updateMany` (shift) and `update` (move) are NOT in the same
transaction as the source-column compaction. Concurrent moves can interleave.

---

## DocSection.position

**Field type:** `Int @default(0)` (prisma/schema.prisma:346)

**Write locations:**

| File | Function | Mechanism | Transaction? |
|------|----------|-----------|-------------|
| `src/app/api/docs/[projectKey]/sections/route.ts:56-68` | POST | `max + 1` at creation | No |
| `src/app/api/docs/[projectKey]/sections/[sectionId]/route.ts:44-47` | PATCH | Direct `data.position = position` | No |

**No bulk reorder endpoint.** Client sends individual PATCH calls per section to reorder.
A single `update` is atomically safe but concurrent PATCH calls from the same client
can race if the client sends multiple reorders rapidly.

---

## DocPage.position

**Field type:** `Int @default(0)` (prisma/schema.prisma:367)

**Write locations:**

| File | Function | Mechanism | Transaction? |
|------|----------|-----------|-------------|
| `src/app/api/docs/[projectKey]/pages/route.ts:75-89` | POST | `max + 1` at creation, scoped by (docSpaceId, sectionId) | No |
| `src/app/api/docs/[projectKey]/pages/[pageId]/route.ts:70` | PATCH | Direct `data.position = position` | No |

Same pattern as DocSection — no bulk reorder endpoint.

---

## Conclusion

All positions are **integers**. The applicable fix strategy is:
- Wrap `moveIssue` in a single transaction and fully reindex the affected column(s)
- Add try/catch returning error on position write failures in all handlers
- Add composite indexes: `@@index([projectId, status, position])` on Issue,
  `@@index([docSpaceId, position])` on DocSection,
  `@@index([docSpaceId, sectionId, position])` on DocPage
