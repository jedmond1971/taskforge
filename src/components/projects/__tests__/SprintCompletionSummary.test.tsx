// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SprintCompletionSummary, MAX_LISTED } from "../SprintCompletionSummary";

const issue = (n: number, category: "TODO" | "IN_PROGRESS" | "DONE", statusName: string = category) => ({
  id: `id-${n}`,
  key: `PRJ-${n}`,
  title: `Issue number ${n}`,
  projectStatus: { name: statusName, category },
});

describe("SprintCompletionSummary (JFR-182)", () => {
  it("states how many are Done and how many return, and lists the returning ones with their status", () => {
    render(
      <SprintCompletionSummary
        issues={[issue(1, "DONE"), issue(2, "DONE"), issue(3, "TODO", "To Do"), issue(4, "IN_PROGRESS", "In Review")]}
      />
    );
    const summary = screen.getByTestId("sprint-completion-summary");
    expect(summary.textContent).toContain("2 issues are Done and will stay in the sprint.");
    expect(summary.textContent).toContain("2 issues are not Done and will return to the backlog.");
    expect(within(summary).getByText("PRJ-3")).toBeTruthy();
    expect(within(summary).getByText("In Review")).toBeTruthy();
    expect(within(summary).queryByText("PRJ-1")).toBeNull(); // Done issues aren't listed
  });

  it("uses singular wording for exactly one issue", () => {
    render(<SprintCompletionSummary issues={[issue(1, "DONE"), issue(2, "TODO")]} />);
    const text = screen.getByTestId("sprint-completion-summary").textContent!;
    expect(text).toContain("1 issue is Done and will stay in the sprint.");
    expect(text).toContain("1 issue is not Done and will return to the backlog.");
  });

  it("says nothing returns, and lists nothing, when every issue is Done", () => {
    render(<SprintCompletionSummary issues={[issue(1, "DONE"), issue(2, "DONE")]} />);
    const text = screen.getByTestId("sprint-completion-summary").textContent!;
    expect(text).toContain("0 issues will return to the backlog.");
    expect(screen.queryByText("Returning to the backlog")).toBeNull();
  });

  it("caps a long list and reports the remainder", () => {
    const issues = Array.from({ length: MAX_LISTED + 5 }, (_, i) => issue(i + 1, "TODO"));
    render(<SprintCompletionSummary issues={issues} />);
    expect(screen.getAllByText(/^PRJ-\d+$/)).toHaveLength(MAX_LISTED);
    expect(screen.getByText("and 5 more")).toBeTruthy();
    // ...but the count in the sentence covers all of them.
    expect(screen.getByTestId("sprint-completion-summary").textContent).toContain(`${MAX_LISTED + 5} issues are not Done`);
  });

  it("handles an empty sprint", () => {
    render(<SprintCompletionSummary issues={[]} />);
    expect(screen.getByText("This sprint has no issues.")).toBeTruthy();
  });
});
