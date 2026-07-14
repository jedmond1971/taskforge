"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

type ActionResult = { success: true } | { success: false; error: string };

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user) return { success: false, error: "User not found" };

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) return { success: false, error: "Current password is incorrect" };

  if (newPassword.length < 8)
    return { success: false, error: "New password must be at least 8 characters" };

  if (newPassword === currentPassword)
    return { success: false, error: "New password must be different from your current password" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 12),
      sessionVersion: { increment: 1 },
    },
  });

  return { success: true };
}
