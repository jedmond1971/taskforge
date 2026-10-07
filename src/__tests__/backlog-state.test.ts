import { describe, it, expect } from "vitest";
import { moveIssueToSprint } from "@/lib/backlog-state";

const issue = (id: string) => ({ id });
const base = () => ({
  sprints: [
    { id: "s1", issues: [issue("a")] },
    { id: "s2", issues: [] as { id: string }[] },
  ],
  backlogIssues: [issue("b"), issue("c")],
});

describe("moveIssueToSprint (JFR-181)", () => {
  it("moves a backlog issue to the end of the target sprint and updates both counts", () => {
    const next = moveIssueToSprint(base(), "b", "s1");
    expect(next.sprints[0].issues.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.sprints[1].issues).toEqual([]);
    expect(next.backlogIssues.map((i) => i.id)).toEqual(["c"]);
  });

  it("does not mutate its input", () => {
    const state = base();
    moveIssueToSprint(state, "b", "s2");
    expect(state).toEqual(base());
  });

  it("is a no-op (same reference) for an issue that is not in the backlog", () => {
    const state = base();
    expect(moveIssueToSprint(state, "a", "s2")).toBe(state);
    expect(moveIssueToSprint(state, "missing", "s2")).toBe(state);
  });

  it("is a no-op for an unknown sprint, leaving the issue in the backlog", () => {
    const state = base();
    expect(moveIssueToSprint(state, "b", "nope")).toBe(state);
  });
});
