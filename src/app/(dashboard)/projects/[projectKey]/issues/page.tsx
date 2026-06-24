import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { IssuePriority, IssueType } from "@prisma/client";
import {
  getIssues,
  getProjectMembers,
  getProjectStatuses,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueList } from "@/components/issues/IssueList";
import { IssueFiltersBar } from "@/components/issues/IssueFiltersBar";
import { AutoRefresh } from "@/components/layout/AutoRefresh";

interface PageProps {
  params: { projectKey: string };
  searchParams: {
    status?: string;
    priority?: string;
    type?: string;
    assigneeId?: string;
    search?: string;
  };
}

function isValidPriority(v: string): v is IssuePriority {
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(v);
}
function isValidType(v: string): v is IssueType {
  return ["BUG", "TASK", "STORY", "EPIC"].includes(v);
}

export default async function IssuesPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [allStatuses, members] = await Promise.all([
    getProjectStatuses(params.projectKey),
    getProjectMembers(params.projectKey),
  ]);

  // Resolve status name → statusId for filtering
  let statusId: string | undefined;
  if (searchParams.status) {
    const match = allStatuses.find(
      (s) => s.name.toLowerCase() === searchParams.status!.toLowerCase()
    );
    statusId = match?.id;
  }

  const filters = {
    ...(statusId && { statusId }),
    ...(searchParams.priority && isValidPriority(searchParams.priority) && { priority: searchParams.priority }),
    ...(searchParams.type && isValidType(searchParams.type) && { type: searchParams.type }),
    ...(searchParams.assigneeId && { assigneeId: searchParams.assigneeId }),
    ...(searchParams.search && { search: searchParams.search }),
  };

  const issues = await getIssues(params.projectKey, filters);

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">Issues</h2>
          <p className="text-zinc-500 text-sm">{issues.length} issue{issues.length !== 1 ? "s" : ""}</p>
        </div>
      </div>
      <Suspense fallback={<div className="h-10" />}>
        <IssueFiltersBar
          members={members.map((m) => m.user)}
          statuses={allStatuses}
          projectKey={params.projectKey}
          currentFilters={searchParams}
        />
      </Suspense>
      <IssueList issues={issues} projectKey={params.projectKey} statuses={allStatuses} />
    </div>
  );
}
