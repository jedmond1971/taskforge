import { prisma } from "./prisma";

export async function generateIssueKey(projectKey: string): Promise<string> {
  // Fetch all keys and compute the numeric max in JS to avoid lexicographic sort
  // issues (e.g. "TFE-9" > "TFE-10" in string order) and Prisma/Postgres type
  // casting problems with raw parameterized SUBSTRING queries.
  const prefix = `${projectKey}-`;
  const issues = await prisma.issue.findMany({
    where: { key: { startsWith: prefix } },
    select: { key: true },
  });

  const maxNum = issues.reduce((max, { key }) => {
    const n = parseInt(key.slice(prefix.length), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);

  return `${prefix}${maxNum + 1}`;
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
