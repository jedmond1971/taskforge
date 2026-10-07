// First-run checklist for the dashboard (JFR-186). Pure so the role gating and completion rules
// can be tested without a database; the dashboard page supplies the facts.

export type OnboardingFacts = {
  /** OWNER/ADMIN of the active org, or a platform admin. Only they see the steps. */
  canSetUp: boolean;
  /** Platform admins invite from /admin/invites; org owners/admins from a project's members settings. */
  isPlatformAdmin: boolean;
  orgProjectCount: number;
  orgMemberCount: number;
  orgInviteCount: number;
  orgIssueCount: number;
  orgDocPageCount: number;
  /** Key of a project the user belongs to, used to deep-link steps that need one. */
  firstProjectKey: string | null;
  /** The viewer is a member of at least one active project. */
  hasProjects: boolean;
};

export type OnboardingStep = {
  id: "project" | "invite" | "issue" | "doc";
  label: string;
  description: string;
  done: boolean;
  /** null while the step is blocked on an earlier one (e.g. no project to open yet). */
  href: string | null;
};

export type OnboardingState =
  | { kind: "hidden" }
  | { kind: "ask-admin" }
  | { kind: "checklist"; steps: OnboardingStep[] };

export function buildOnboarding(f: OnboardingFacts): OnboardingState {
  if (!f.canSetUp) {
    // A plain member with nothing to work on yet is pointed at their admin; everyone else sees nothing.
    return f.hasProjects ? { kind: "hidden" } : { kind: "ask-admin" };
  }

  const key = f.firstProjectKey;
  const steps: OnboardingStep[] = [
    {
      id: "project",
      label: "Create your first project",
      description: "Projects hold your issues, board and docs.",
      done: f.orgProjectCount > 0,
      href: "/projects",
    },
    {
      id: "invite",
      label: "Invite teammates",
      description: "Add the people you'll work with.",
      done: f.orgMemberCount > 1 || f.orgInviteCount > 0,
      href: f.isPlatformAdmin ? "/admin/invites" : key ? `/projects/${key}/settings` : null,
    },
    {
      id: "issue",
      label: "Create your first issue",
      description: "Track a piece of work on the board.",
      done: f.orgIssueCount > 0,
      href: key ? `/projects/${key}/issues` : null,
    },
    {
      id: "doc",
      label: "Write a doc page",
      description: "Capture notes, specs or decisions.",
      done: f.orgDocPageCount > 0,
      href: key ? `/projects/${key}/docs` : null,
    },
  ];

  if (steps.every((s) => s.done)) return { kind: "hidden" };
  return { kind: "checklist", steps };
}
