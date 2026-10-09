# Content search — approach decision (JFR-193, 2026-10-09)

Scope: extending `paletteSearch` (`src/app/(dashboard)/command-palette-actions.ts`) from titles to issue descriptions, comment bodies and doc page content (JFR-194). All three fields store **TipTap HTML**, so whatever we choose has to cope with markup.

## Decision

**Phase 1: case-insensitive substring match (`contains` / `ILIKE`) with no schema change, strip HTML and build snippets in application code.** Pre-agreed escalation if it gets slow: a `pg_trgm` GIN **expression** index (below). Postgres full-text search (`tsvector`) is rejected for the palette.

## Measurements

Scratch schema on the local Docker Postgres, 200k rows, ~470 B of HTML each (94 MB heap), dropped afterwards. Synthetic and worse than real data for ranking (common words hit ~95% of rows), but fine for comparing mechanisms.

| Approach | Hit (LIMIT 8) | Miss | Index size / build |
|---|---|---|---|
| `ILIKE '%x%'`, no index | 2 ms | **1.06 s** (seq scan) | none |
| trigram GIN on `regexp_replace(body,'<[^>]+>',' ','g')` | 56 ms | 0.4 ms | built in 16 s |
| tsvector GIN on the same expression | 23 ms | <1 ms | built in 13 s |
| tsvector + `ts_rank` + `ts_headline` over **all** matches | **9.9 s** | - | - |

Takeaways:

- Unindexed `ILIKE` is only slow on a **miss** over a very large table. Every palette query is already filtered to projects the caller is a member of and that are not closed, so the scanned set is a small fraction of the table, and production is orders of magnitude below 200k rows. Not a problem today.
- `ts_headline`/`ts_rank` on every match is the trap: cost scales with matches, not the `LIMIT`. If FTS were ever used, ranking and headlines must run in an outer query over the already-limited ids.

## Why not tsvector

1. **Palette is type-ahead, and titles already match by substring.** `tsvector` matches whole lexemes: typing `rollb` finds nothing unless every query is rewritten to a `:*` prefix tsquery, and a mid-word fragment (`ollback`, a ticket-key fragment, an identifier like `ERR_TIMEOUT`) never matches. Users would see titles match on substrings and bodies not.
2. **Stemming/language config is a product decision** (`english` mangles identifiers, `simple` loses stemming); the content is multi-lingual-capable and code-heavy.
3. **The index must be an expression index** (`to_tsvector(..., regexp_replace(content, '<[^>]+>', ' ', 'g'))`) or a maintained column, because raw HTML would index tag and attribute names. Prisma can't declare expression indexes, so it lives only in a raw-SQL migration and `prisma migrate dev` can later propose dropping it.
4. Ranking benefit is small for a result list capped at 5-8 rows per group, ordered by `updatedAt desc` like the title matches.

## Snippets

Built in application code from the matched row, not in SQL: strip tags, decode entities, collapse whitespace, then take a window of ~120 chars around the first case-insensitive occurrence of the query with `…` at cut ends. The client renders it as **text** (never `dangerouslySetInnerHTML`); highlighting splits the string on the query and wraps matches in `<mark>` React nodes. Cap the content scanned per row (first ~20k chars) so one huge doc can't dominate.

**Known false-positive:** `ILIKE` on raw HTML also matches tag/attribute text (`strong`, `href`, `class`). Post-filter after stripping: fetch a small multiple of the cap, drop rows whose *stripped* text doesn't contain the query, then slice to the cap.

## Escalation path (don't build until a trigger fires)

Trigger: palette `paletteSearch` p95 over ~300 ms in production, or any content table past ~50k rows. Then add, in a raw-SQL migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "DocPage_content_trgm" ON "DocPage"
  USING gin ((regexp_replace(content, '<[^>]+>', ' ', 'g')) gin_trgm_ops);
```

(same for `Issue.description` and `Comment.body`) and query with the identical expression so the planner uses it. Trigram keeps substring semantics, so no behaviour change. Needs the extension to be creatable on Railway Postgres (verify on staging first), and Prisma `contains` would have to become `$queryRaw` for those three fields.
