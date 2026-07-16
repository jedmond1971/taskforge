"use server";

import { prisma } from "@/lib/prisma";
import { requireOrgRole, canManageApiKeys } from "@/lib/permissions";
import { generateApiKey, hashApiKey } from "@/lib/api-keys";

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: { name: string };
};

export async function listApiKeys(orgId: string): Promise<ApiKeyRow[]> {
  await requireOrgRole(orgId, canManageApiKeys);

  const keys = await prisma.apiKey.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdBy: { name: k.createdBy.name },
  }));
}

export async function createApiKey(
  orgId: string,
  name: string
): Promise<{ success: true; plaintext: string; key: ApiKeyRow } | { success: false; error: string }> {
  const { userId } = await requireOrgRole(orgId, canManageApiKeys);

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name is required" };
  if (trimmed.length > 100) return { success: false, error: "Name must be 100 characters or fewer" };

  const plaintext = generateApiKey();
  const keyPrefix = plaintext.slice(0, 8);
  const hashedKey = hashApiKey(plaintext);

  const created = await prisma.apiKey.create({
    data: {
      orgId,
      name: trimmed,
      keyPrefix,
      hashedKey,
      createdById: userId,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdBy: { select: { name: true } },
    },
  });

  return {
    success: true,
    plaintext,
    key: {
      id: created.id,
      name: created.name,
      keyPrefix: created.keyPrefix,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdBy: { name: created.createdBy.name },
    },
  };
}

export async function revokeApiKey(
  orgId: string,
  keyId: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageApiKeys);

  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { orgId: true, revokedAt: true },
  });

  if (!key || key.orgId !== orgId) {
    return { success: false, error: "API key not found" };
  }
  if (key.revokedAt !== null) {
    return { success: false, error: "Key is already revoked" };
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return { success: true };
}
