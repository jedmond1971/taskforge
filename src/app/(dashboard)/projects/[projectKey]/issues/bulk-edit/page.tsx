import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { IssuePriority, IssueType } from "@prisma/client";
import {
  getIssues,
  getProjectMembers,
  getProjectStatuses,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueFiltersBar } from "@/components/issues/IssueFiltersBar";
import { BulkEditView } from "@/components/issues/BulkEditView";
import { ArrowLeft } from "lucide-react";

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

export default async function BulkEditPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [allStatuses, members] = await Promise.all([
    getProjectStatuses(params.projectKey),
    getProjectMembers(params.projectKey),
  ]);

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

  const backParams = new URLSearchParams();
  if (searchParams.status) backParams.set("status", searchParams.status);
  if (searchParams.priority) backParams.set("priority", searchParams.priority);
  if (searchParams.type) backParams.set("type", searchParams.type);
  if (searchParams.assigneeId) backParams.set("assigneeId", searchParams.assigneeId);
  if (searchParams.search) backParams.set("search", searchParams.search);
  const backQuery = backParams.toString();
  const backHref = `/projects/${params.projectKey}/issues${backQuery ? `?${backQuery}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Issues
        </Link>
        <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">Bulk Edit Issues</h2>
        <p className="text-zinc-500 text-sm">
          {issues.length} issue{issues.length !== 1 ? "s" : ""} match the current filters
        </p>
      </div>
      <Suspense fallback={<div className="h-10" />}>
        <IssueFiltersBar
          members={members.map((m) => m.user)}
          statuses={allStatuses}
          projectKey={params.projectKey}
          currentFilters={searchParams}
        />
      </Suspense>
      <BulkEditView
        issues={issues}
        statuses={allStatuses}
        members={members.map((m) => m.user)}
        projectKey={params.projectKey}
        backHref={backHref}
      />
    </div>
  );
}
