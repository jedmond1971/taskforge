import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getIssue, getProjectMembers } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueDetail } from "@/components/issues/IssueDetail";

interface PageProps {
  params: { projectKey: string; issueKey: string };
}

export default async function IssueDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [issue, members] = await Promise.all([
    getIssue(params.projectKey, params.issueKey),
    getProjectMembers(params.projectKey),
  ]);

  if (!issue) notFound();

  return (
    <IssueDetail
      issue={issue}
      members={members.map((m) => m.user)}
      projectKey={params.projectKey}
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? ""}
    />
  );
}
