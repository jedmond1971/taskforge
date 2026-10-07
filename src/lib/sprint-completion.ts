import { StatusCategory } from "@prisma/client";

// The one definition of "this issue is finished" for completing a sprint (JFR-182). completeSprint
// queries `ProjectStatus` by this category to decide what to unassign, and the confirmation dialog
// partitions the sprint's issues with it to preview the result — so the preview can't disagree
// with what happens. Don't compare against a status *name*.
export const DONE_CATEGORY = StatusCategory.DONE;

export function isDoneForSprint(issue: { projectStatus: { category: StatusCategory } }): boolean {
  return issue.projectStatus.category === DONE_CATEGORY;
}

/** What completing a sprint would do: Done issues stay, everything else returns to the backlog. */
export function summarizeSprintCompletion<I extends { projectStatus: { category: StatusCategory } }>(
  issues: I[]
): { done: I[]; returning: I[] } {
  const done: I[] = [];
  const returning: I[] = [];
  for (const issue of issues) (isDoneForSprint(issue) ? done : returning).push(issue);
  return { done, returning };
}
