"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSnippet,
  detectIssueKey,
  isContentSearchable,
  isSearchable,
  normalizeQuery,
  type Snippet,
} from "@/lib/command-palette";

export interface ContentHit {
  kind: "issue" | "comment" | "doc";
  /** Issue key for issue/comment hits, doc page id for doc hits. */
  ref: string;
  title: string;
  projectKey: string;
  snippet: Snippet;
}

export type PaletteSearchResult =
  | {
      ok: true;
      projects: { key: string; name: string }[];
      issues: {
        key: string;
        title: string;
        projectKey: string;
        statusName: string;
        statusCategory: "TODO" | "IN_PROGRESS" | "DONE";
        priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
      }[];
      docs: { id: string; title: string; projectKey: string; sectionTitle: string | null }[];
      content: ContentHit[];
    }
  | { ok: false; error: "unauthorized" | "failed" };

const PROJECT_CAP = 5;
const ISSUE_CAP = 8;
const DOC_CAP = 5;
const CONTENT_CAP = 4; // per source (issue descriptions, comments, doc bodies)
// Rows fetched per source before dropping SQL matches that were only tag/attribute text.
const CONTENT_FETCH = CONTENT_CAP * 4;

/**
 * Global command-palette search (JFR-176). Plain-text only — never parsed as FQL.
 * Every query is scoped to projects the caller is a ProjectMember of and that are
 * not closed, so a key or title can never surface another tenant's data, and a
 * non-member gets the same empty result as "does not exist". Public docspaces of
 * projects the caller isn't in are deliberately excluded (JFR-194: kept excluded — a public
 * docspace is readable by org members via its link, but surfacing it here would put another
 * team's text in a search box the caller never opted into).
 *
 * Content matches (JFR-194, approach in .context-docs/search-approach.md) are case-insensitive
 * substring matches on issue descriptions, comment bodies and doc page content. Those fields
 * hold HTML, so each candidate is stripped to text and re-checked, and the snippet is returned
 * as plain-text parts for the client to render as text.
 */
export async function paletteSearch(rawQuery: string): Promise<PaletteSearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const query = normalizeQuery(rawQuery);
  if (!isSearchable(query)) return { ok: true, projects: [], issues: [], docs: [], content: [] };

  const userId = user.id;
  const projectScope = { members: { some: { userId } }, isClosed: false };
  const issueKey = detectIssueKey(query);
  const searchContent = isContentSearchable(query);
  const contentMatch = { contains: query, mode: "insensitive" as const };
  const none = <T,>(): Promise<T[]> => Promise.resolve([]);

  try {
    const issueSelect = {
      key: true,
      title: true,
      priority: true,
      project: { select: { key: true } },
      projectStatus: { select: { name: true, category: true } },
    } as const;

    const [projects, titleIssues, exactIssues, docs, descIssues, commentRows, docBodies] = await Promise.all([
      prisma.project.findMany({
        where: {
          ...projectScope,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { key: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { key: true, name: true },
        orderBy: { name: "asc" },
        take: PROJECT_CAP,
      }),
      prisma.issue.findMany({
        where: {
          project: projectScope,
          title: { contains: query, mode: "insensitive" },
        },
        select: issueSelect,
        orderBy: { updatedAt: "desc" },
        take: ISSUE_CAP,
      }),
      issueKey
        ? prisma.issue.findMany({
            where: { key: issueKey, project: projectScope },
            select: issueSelect,
            take: 1,
          })
        : Promise.resolve([]),
      prisma.docPage.findMany({
        where: {
          title: { contains: query, mode: "insensitive" },
          docSpace: { project: projectScope },
        },
        select: {
          id: true,
          title: true,
          section: { select: { title: true } },
          docSpace: { select: { project: { select: { key: true } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: DOC_CAP,
      }),
      searchContent
        ? prisma.issue.findMany({
            where: { project: projectScope, description: contentMatch },
            select: { key: true, title: true, description: true, project: { select: { key: true } } },
            orderBy: { updatedAt: "desc" },
            take: CONTENT_FETCH,
          })
        : none<never>(),
      searchContent
        ? prisma.comment.findMany({
            where: { issue: { project: projectScope }, body: contentMatch },
            select: {
              body: true,
              issue: { select: { key: true, title: true, project: { select: { key: true } } } },
            },
            orderBy: { updatedAt: "desc" },
            take: CONTENT_FETCH,
          })
        : none<never>(),
      searchContent
        ? prisma.docPage.findMany({
            where: { docSpace: { project: projectScope }, content: contentMatch },
            select: {
              id: true,
              title: true,
              content: true,
              docSpace: { select: { project: { select: { key: true } } } },
            },
            orderBy: { updatedAt: "desc" },
            take: CONTENT_FETCH,
          })
        : none<never>(),
    ]);

    const seen = new Set<string>();
    const issues = [...exactIssues, ...titleIssues]
      .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
      .slice(0, ISSUE_CAP)
      .map((i) => ({
        key: i.key,
        title: i.title,
        projectKey: i.project.key,
        statusName: i.projectStatus.name,
        statusCategory: i.projectStatus.category,
        priority: i.priority,
      }));

    // A title match already shows the row; content hits add what the title can't.
    const titleKeys = new Set(issues.map((i) => i.key));
    const titleDocIds = new Set(docs.map((d) => d.id));
    const content: ContentHit[] = [];
    const take = (hits: ContentHit[]) => content.push(...hits.slice(0, CONTENT_CAP));

    const inDesc: ContentHit[] = [];
    for (const i of descIssues) {
      const snippet = titleKeys.has(i.key) ? null : buildSnippet(i.description, query);
      if (snippet) inDesc.push({ kind: "issue", ref: i.key, title: i.title, projectKey: i.project.key, snippet });
    }
    const inComments: ContentHit[] = [];
    const commentedIssues = new Set<string>();
    for (const c of commentRows) {
      if (commentedIssues.has(c.issue.key)) continue; // one hit per issue
      const snippet = buildSnippet(c.body, query);
      if (!snippet) continue;
      commentedIssues.add(c.issue.key);
      inComments.push({ kind: "comment", ref: c.issue.key, title: c.issue.title, projectKey: c.issue.project.key, snippet });
    }
    const inDocs: ContentHit[] = [];
    for (const d of docBodies) {
      const snippet = titleDocIds.has(d.id) ? null : buildSnippet(d.content, query);
      if (snippet) inDocs.push({ kind: "doc", ref: d.id, title: d.title, projectKey: d.docSpace.project.key, snippet });
    }
    take(inDocs);
    take(inDesc);
    take(inComments);

    return {
      ok: true,
      projects,
      issues,
      docs: docs.map((d) => ({
        id: d.id,
        title: d.title,
        projectKey: d.docSpace.project.key,
        sectionTitle: d.section?.title ?? null,
      })),
      content,
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}
