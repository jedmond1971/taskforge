// Pure state transitions for the Backlog page's optimistic UI (JFR-181), kept out of the
// component so they can be unit-tested without dnd-kit or a DOM.

export type BacklogState<I extends { id: string }, S extends { id: string; issues: I[] }> = {
  sprints: S[];
  backlogIssues: I[];
};

/**
 * Move one backlog issue to the end of a sprint. Returns the same object when the issue is
 * not in the backlog or the sprint is unknown, so a stale or repeated drop is a no-op.
 */
export function moveIssueToSprint<I extends { id: string }, S extends { id: string; issues: I[] }>(
  state: BacklogState<I, S>,
  issueId: string,
  sprintId: string
): BacklogState<I, S> {
  const issue = state.backlogIssues.find((i) => i.id === issueId);
  if (!issue || !state.sprints.some((s) => s.id === sprintId)) return state;
  return {
    sprints: state.sprints.map((s) => (s.id === sprintId ? { ...s, issues: [...s.issues, issue] } : s)),
    backlogIssues: state.backlogIssues.filter((i) => i.id !== issueId),
  };
}
