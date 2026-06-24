import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getIssue,
  getProjectMembers,
  getProjectStatuses,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { canEditIssues } from "@/lib/permissions";

interface PageProps {
  params: { projectKey: string; issueKey: string };
}

export default async function IssueDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [issue, members, statuses] = await Promise.all([
    getIssue(params.projectKey, params.issueKey),
    getProjectMembers(params.projectKey),
    getProjectStatuses(params.projectKey),
  ]);

  if (!issue) notFound();

  const currentMember = members.find((m) => m.userId === session.user.id);
  const canEdit = currentMember ? canEditIssues(currentMember.role) : false;

  return (
    <IssueDetail
      issue={issue}
      members={members.map((m) => m.user)}
      statuses={statuses}
      projectKey={params.projectKey}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? ""}
      canEdit={canEdit}
    />
  );
}
