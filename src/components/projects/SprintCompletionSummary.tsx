import { StatusCategory } from "@prisma/client";
import { summarizeSprintCompletion } from "@/lib/sprint-completion";
import { MonoMeta } from "@/components/ui/mono-meta";

type SummaryIssue = {
  id: string;
  key: string;
  title: string;
  projectStatus: { name: string; category: StatusCategory };
};

// How many issues are listed before "and N more" — the dialog must stay readable for a big sprint.
export const MAX_LISTED = 8;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The body of the "Complete this sprint?" dialog: what stays, and what goes back to the backlog. */
export function SprintCompletionSummary({ issues }: { issues: SummaryIssue[] }) {
  const { done, returning } = summarizeSprintCompletion(issues);

  if (issues.length === 0) {
    return <p className="text-sm text-muted-foreground">This sprint has no issues.</p>;
  }

  return (
    <div className="space-y-3 text-sm" data-testid="sprint-completion-summary">
      <ul className="space-y-1 text-foreground">
        <li>
          <strong>{plural(done.length, "issue")}</strong> {done.length === 1 ? "is" : "are"} Done and will stay in the sprint.
        </li>
        <li>
          <strong>{plural(returning.length, "issue")}</strong>{" "}
          {returning.length === 0
            ? "will return to the backlog."
            : `${returning.length === 1 ? "is" : "are"} not Done and will return to the backlog.`}
        </li>
      </ul>

      {returning.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Returning to the backlog</p>
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-border-soft divide-y divide-border-soft">
            {returning.slice(0, MAX_LISTED).map((issue) => (
              <li key={issue.id} className="flex items-center gap-2 px-3 py-1.5">
                <MonoMeta className="flex-shrink-0">{issue.key}</MonoMeta>
                <span className="truncate flex-1 text-foreground">{issue.title}</span>
                <span className="flex-shrink-0 text-xs text-muted-foreground">{issue.projectStatus.name}</span>
              </li>
            ))}
            {returning.length > MAX_LISTED && (
              <li className="px-3 py-1.5 text-xs text-muted-foreground">
                and {returning.length - MAX_LISTED} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
