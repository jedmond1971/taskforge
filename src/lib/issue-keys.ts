import { prisma } from "./prisma";

export async function generateIssueKey(projectKey: string): Promise<string> {
  // Use a raw query to get the true numeric max, avoiding lexicographic sort issues
  // (e.g. "TFE-9" sorts higher than "TFE-10" in string order).
  // Strip the known prefix so project keys containing hyphens are handled correctly.
  const prefix = `${projectKey}-`;
  const result = await prisma.$queryRaw<{ max_num: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(key FROM ${prefix.length + 1}) AS INTEGER)) AS max_num
    FROM "Issue"
    WHERE key LIKE ${`${prefix}%`}
  `;

  const maxNum = result[0]?.max_num ?? 0;
  return `${projectKey}-${maxNum + 1}`;
}

export async function generateIssueKeyWithRetry(
  projectKey: string,
  maxRetries = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = await generateIssueKey(projectKey);
    const exists = await prisma.issue.findUnique({ where: { key }, select: { key: true } });
    if (!exists) return key;
  }
  throw new Error(`Could not generate a unique issue key for project ${projectKey} after ${maxRetries} attempts`);
}
