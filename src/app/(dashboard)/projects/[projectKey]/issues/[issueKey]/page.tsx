import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getIssue,
  getProjectMembers,
  getProjectStatuses,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import {
  getApplicableCustomFields,
  getCustomFieldValues,
} from "@/app/(dashboard)/projects/[projectKey]/issues/[issueKey]/custom-field-value-actions";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { isAiChatEnabled } from "@/lib/ai/feature-flag";
import { prisma } from "@/lib/prisma";

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

  const [customFields, customFieldValues] = await Promise.all([
    getApplicableCustomFields(params.projectKey),
    getCustomFieldValues(params.projectKey, issue.id),
  ]);

  const currentMember = members.find((m) => m.userId === session.user.id);
  const project = currentMember
    ? await prisma.project.findUnique({
        where: { key: params.projectKey.toUpperCase() },
        select: { orgId: true },
      })
    : null;
  const grants = project
    ? await getUserGrants(session.user.id, project.orgId, issue.projectId)
    : undefined;
  const canEdit = currentMember ? canEditIssues(currentMember.role, grants) : false;

  return (
    <IssueDetail
      issue={issue}
      members={members.map((m) => m.user)}
      statuses={statuses}
      projectKey={params.projectKey}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? ""}
      canEdit={canEdit}
      customFields={customFields}
      customFieldValues={customFieldValues}
      aiChatEnabled={isAiChatEnabled()}
    />
  );
}
