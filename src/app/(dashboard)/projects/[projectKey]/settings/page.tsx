import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { ProjectSettings } from "./ProjectSettings";

export default async function SettingsPage({
  params,
}: {
  params: { projectKey: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const project = await prisma.project.findFirst({
    where: {
      key: params.projectKey.toUpperCase(),
      members: { some: { userId: session.user.id } },
    },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { role: "asc" },
      },
    },
  });
  if (!project) notFound();

  const currentMember = project.members.find(
    (m) => m.userId === session.user.id
  );
  if (
    !currentMember ||
    (currentMember.role !== "OWNER" && currentMember.role !== "ADMIN")
  ) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-100 mb-2">
            Access Denied
          </h2>
          <p className="text-sm text-zinc-500">
            You don&apos;t have permission to access project settings.
          </p>
        </div>
      </div>
    );
  }

  const owner = project.members.find((m) => m.role === "OWNER");

  return (
    <ProjectSettings
      project={{
        id: project.id,
        name: project.name,
        key: project.key,
        description: project.description,
        createdAt: project.createdAt.toISOString(),
      }}
      members={project.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        user: m.user,
      }))}
      currentUserId={session.user.id}
      currentUserRole={currentMember.role}
      ownerName={owner?.user.name ?? "Unknown"}
      projectKey={params.projectKey}
    />
  );
}
