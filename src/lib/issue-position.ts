import { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

// Serializes concurrent issue creates/moves for a project so the MAX(position)
// read below and the subsequent write can't race across separate requests.
// Mirrors the lock already used by the UI's moveIssue/createIssue actions.
export async function lockProjectForPositionWrite(tx: TxClient, projectId: string) {
  await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
}

// MAX(position)+1 scoped to (projectId, statusId) — unlike COUNT(*), this is
// immune to gaps left by deletions/reorders (see JFR-122: a column with
// positions 0,1,3 has COUNT()===3, which collides with the existing row at 3).
export async function nextPositionInStatus(
  tx: TxClient,
  projectId: string,
  statusId: string
): Promise<number> {
  const result = await tx.issue.aggregate({
    where: { projectId, statusId },
    _max: { position: true },
  });
  return (result._max.position ?? -1) + 1;
}
