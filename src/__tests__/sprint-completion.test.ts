import { describe, it, expect } from "vitest";
import { StatusCategory } from "@prisma/client";
import { DONE_CATEGORY, isDoneForSprint, summarizeSprintCompletion } from "@/lib/sprint-completion";

const issue = (id: string, category: StatusCategory) => ({ id, projectStatus: { category } });

describe("sprint completion summary (JFR-182)", () => {
  it("treats only the DONE category as finished", () => {
    expect(DONE_CATEGORY).toBe("DONE");
    expect(isDoneForSprint(issue("a", "DONE"))).toBe(true);
    expect(isDoneForSprint(issue("a", "TODO"))).toBe(false);
    expect(isDoneForSprint(issue("a", "IN_PROGRESS"))).toBe(false);
  });

  it("splits Done issues (stay) from everything else (return), keeping order", () => {
    const issues = [issue("1", "TODO"), issue("2", "DONE"), issue("3", "IN_PROGRESS"), issue("4", "DONE")];
    const { done, returning } = summarizeSprintCompletion(issues);
    expect(done.map((i) => i.id)).toEqual(["2", "4"]);
    expect(returning.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("handles an empty sprint, an all-Done sprint and a none-Done sprint", () => {
    expect(summarizeSprintCompletion([])).toEqual({ done: [], returning: [] });
    expect(summarizeSprintCompletion([issue("1", "DONE")]).returning).toHaveLength(0);
    expect(summarizeSprintCompletion([issue("1", "TODO")]).done).toHaveLength(0);
  });

  it("does not mutate its input", () => {
    const issues = [issue("1", "TODO"), issue("2", "DONE")];
    summarizeSprintCompletion(issues);
    expect(issues.map((i) => i.id)).toEqual(["1", "2"]);
  });
});
