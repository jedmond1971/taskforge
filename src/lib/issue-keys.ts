import { prisma } from "./prisma";

export async function generateIssueKey(projectKey: string): Promise<string> {
  // Find the highest existing issue number for this project
  const lastIssue = await prisma.issue.findFirst({
    where: { key: { startsWith: `${projectKey}-` } },
    orderBy: { key: "desc" },
    select: { key: true },
  });

  let nextNumber = 1;
  if (lastIssue) {
    const parts = lastIssue.key.split("-");
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) nextNumber = lastNum + 1;
  }

  return `${projectKey}-${nextNumber}`;
}
