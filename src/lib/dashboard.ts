export interface AttentionIssue {
  id: string;
  key: string;
  title: string;
  dueDate: Date | null;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  project: { key: string; name: string };
}

export function buildAttentionItems(
  assigned: AttentionIssue[],
  dueSoon: AttentionIssue[]
): AttentionIssue[] {
  const byId = new Map<string, AttentionIssue>();
  for (const issue of dueSoon) byId.set(issue.id, issue);
  for (const issue of assigned) if (!byId.has(issue.id)) byId.set(issue.id, issue);

  return Array.from(byId.values()).sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}
