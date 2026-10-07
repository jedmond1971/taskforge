import { describe, it, expect } from "vitest";
import { buildOnboarding, type OnboardingFacts } from "@/lib/onboarding";

const base: OnboardingFacts = {
  canSetUp: true,
  isPlatformAdmin: false,
  orgProjectCount: 0,
  orgMemberCount: 1,
  orgInviteCount: 0,
  orgIssueCount: 0,
  orgDocPageCount: 0,
  firstProjectKey: null,
  hasProjects: false,
};

function steps(f: Partial<OnboardingFacts>) {
  const s = buildOnboarding({ ...base, ...f });
  if (s.kind !== "checklist") throw new Error(`expected checklist, got ${s.kind}`);
  return s.steps;
}

describe("buildOnboarding", () => {
  it("shows all four steps, incomplete, to a new org admin", () => {
    const s = steps({});
    expect(s.map((x) => x.id)).toEqual(["project", "invite", "issue", "doc"]);
    expect(s.every((x) => !x.done)).toBe(true);
  });

  it("blocks steps that need a project until one exists", () => {
    const s = steps({});
    expect(s.find((x) => x.id === "project")!.href).toBe("/projects");
    for (const id of ["invite", "issue", "doc"]) expect(s.find((x) => x.id === id)!.href).toBeNull();
  });

  it("deep-links into the first project once there is one", () => {
    const s = steps({ orgProjectCount: 1, firstProjectKey: "PL", hasProjects: true });
    expect(s.find((x) => x.id === "invite")!.href).toBe("/projects/PL/settings");
    expect(s.find((x) => x.id === "issue")!.href).toBe("/projects/PL/issues");
    expect(s.find((x) => x.id === "doc")!.href).toBe("/projects/PL/docs");
  });

  it("sends platform admins to the invites page", () => {
    expect(steps({ isPlatformAdmin: true }).find((x) => x.id === "invite")!.href).toBe("/admin/invites");
  });

  it("counts a second member or a pending invite as 'invited teammates'", () => {
    expect(steps({ orgMemberCount: 2 }).find((x) => x.id === "invite")!.done).toBe(true);
    expect(steps({ orgInviteCount: 1 }).find((x) => x.id === "invite")!.done).toBe(true);
  });

  it("hides itself once every step is complete", () => {
    const s = buildOnboarding({
      ...base, orgProjectCount: 1, orgMemberCount: 3, orgIssueCount: 4, orgDocPageCount: 2,
      firstProjectKey: "PL", hasProjects: true,
    });
    expect(s).toEqual({ kind: "hidden" });
  });

  it("points a member with no projects at their admin, and shows a member with projects nothing", () => {
    expect(buildOnboarding({ ...base, canSetUp: false, hasProjects: false })).toEqual({ kind: "ask-admin" });
    expect(buildOnboarding({ ...base, canSetUp: false, hasProjects: true })).toEqual({ kind: "hidden" });
  });
});
