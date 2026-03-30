import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { getIssues, getProjectMembers } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueList } from "@/components/issues/IssueList";
import { IssueFiltersBar } from "@/components/issues/IssueFiltersBar";

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

function isValidStatus(v: string): v is IssueStatus {
  return ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"].includes(v);
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

  const filters = {
    ...(searchParams.status && isValidStatus(searchParams.status) && { status: searchParams.status }),
    ...(searchParams.priority && isValidPriority(searchParams.priority) && { priority: searchParams.priority }),
    ...(searchParams.type && isValidType(searchParams.type) && { type: searchParams.type }),
    ...(searchParams.assigneeId && { assigneeId: searchParams.assigneeId }),
    ...(searchParams.search && { search: searchParams.search }),
  };

  const [issues, members] = await Promise.all([
    getIssues(params.projectKey, filters),
    getProjectMembers(params.projectKey),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-100">Issues</h2>
          <p className="text-zinc-500 text-sm">{issues.length} issue{issues.length !== 1 ? "s" : ""}</p>
        </div>
      </div>
      <Suspense fallback={<div className="h-10" />}>
        <IssueFiltersBar
          members={members.map((m) => m.user)}
          projectKey={params.projectKey}
          currentFilters={searchParams}
        />
      </Suspense>
      <IssueList issues={issues} projectKey={params.projectKey} />
    </div>
  );
}
