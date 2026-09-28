import { describe, it, expect } from "vitest";
import { buildAttentionItems, type AttentionIssue } from "../dashboard";

function issue(overrides: Partial<AttentionIssue> & { id: string }): AttentionIssue {
  return {
    id: overrides.id,
    key: overrides.key ?? overrides.id,
    title: overrides.title ?? `Issue ${overrides.id}`,
    dueDate: overrides.dueDate ?? null,
    priority: overrides.priority ?? "MEDIUM",
    project: overrides.project ?? { key: "PL", name: "Product Launch" },
  };
}

describe("buildAttentionItems", () => {
  it("puts the most overdue issue first", () => {
    const dueSoon = [
      issue({ id: "a", dueDate: new Date("2026-09-20T00:00:00Z") }),
      issue({ id: "b", dueDate: new Date("2026-09-25T00:00:00Z") }),
    ];
    const result = buildAttentionItems([], dueSoon);
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("orders overdue issues before upcoming ones, then soonest-first", () => {
    const dueSoon = [
      issue({ id: "later", dueDate: new Date("2026-10-02T00:00:00Z") }),
      issue({ id: "overdue", dueDate: new Date("2026-09-27T00:00:00Z") }),
      issue({ id: "sooner", dueDate: new Date("2026-09-29T00:00:00Z") }),
    ];
    const result = buildAttentionItems([], dueSoon);
    expect(result.map((i) => i.id)).toEqual(["overdue", "sooner", "later"]);
  });

  it("places assigned issues with no due date after every dated issue", () => {
    const assigned = [issue({ id: "undated" })];
    const dueSoon = [issue({ id: "dated", dueDate: new Date("2026-09-29T00:00:00Z") })];
    const result = buildAttentionItems(assigned, dueSoon);
    expect(result.map((i) => i.id)).toEqual(["dated", "undated"]);
  });

  it("dedupes an issue that appears in both the assigned and due-soon lists", () => {
    const shared = issue({ id: "shared", dueDate: new Date("2026-09-29T00:00:00Z") });
    const result = buildAttentionItems([shared], [shared]);
    expect(result.map((i) => i.id)).toEqual(["shared"]);
    expect(result).toHaveLength(1);
  });

  it("returns an empty list when both inputs are empty", () => {
    expect(buildAttentionItems([], [])).toEqual([]);
  });
});
