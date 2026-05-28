"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function reopenProject(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized: admin role required");
  }

  const projectId = formData.get("projectId");
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("Invalid projectId");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { isClosed: false },
  });

  revalidatePath("/projects/closed");
  revalidatePath("/projects");
}
