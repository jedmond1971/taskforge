"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getPresignedUploadUrl } from "@/lib/s3";

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: true }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user) throw new Error("User not found");

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) throw new Error("Current password is incorrect");

  if (newPassword.length < 8)
    throw new Error("New password must be at least 8 characters");

  if (newPassword === currentPassword)
    throw new Error("New password must be different from your current password");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });

  return { success: true };
}

export async function getAvatarUploadUrl(): Promise<{ uploadUrl: string; key: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const key = `avatars/${session.user.id}.jpg`;
  const uploadUrl = await getPresignedUploadUrl(key, "image/jpeg", 512 * 1024);
  return { uploadUrl, key };
}

export async function saveAvatar(key: string): Promise<{ avatarUrl: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (key !== `avatars/${session.user.id}.jpg`) throw new Error("Invalid key");

  const avatarUrl = `/api/avatar?key=${key}`;
  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarUrl },
  });
  return { avatarUrl };
}
