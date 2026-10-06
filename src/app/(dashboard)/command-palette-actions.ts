"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectIssueKey, isSearchable, normalizeQuery } from "@/lib/command-palette";

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
    }
  | { ok: false; error: "unauthorized" | "failed" };

const PROJECT_CAP = 5;
const ISSUE_CAP = 8;
const DOC_CAP = 5;

/**
 * Global command-palette search (JFR-176). Plain-text only — never parsed as FQL.
 * Every query is scoped to projects the caller is a ProjectMember of and that are
 * not closed, so a key or title can never surface another tenant's data, and a
 * non-member gets the same empty result as "does not exist". Public docspaces of
 * projects the caller isn't in are deliberately excluded (v1 limitation).
 */
export async function paletteSearch(rawQuery: string): Promise<PaletteSearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const query = normalizeQuery(rawQuery);
  if (!isSearchable(query)) return { ok: true, projects: [], issues: [], docs: [] };

  const userId = user.id;
  const projectScope = { members: { some: { userId } }, isClosed: false };
  const issueKey = detectIssueKey(query);

  try {
    const issueSelect = {
      key: true,
      title: true,
      priority: true,
      project: { select: { key: true } },
      projectStatus: { select: { name: true, category: true } },
    } as const;

    const [projects, titleIssues, exactIssues, docs] = await Promise.all([
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
    };
  } catch {
    return { ok: false, error: "failed" };
  }
}
