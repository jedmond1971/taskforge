// A tiny shared signal between the Kanban board and AutoRefresh (JFR-184). A refresh while a card
// is mid-drag, or while a move is still saving, would reshuffle cards under the user's hand, so
// the board marks itself busy and AutoRefresh holds off until it goes idle.

let busy = false;
const idleListeners = new Set<() => void>();

export function setBoardBusy(next: boolean) {
  if (busy === next) return;
  busy = next;
  if (!busy) for (const listener of Array.from(idleListeners)) listener();
}

export function isBoardBusy() {
  return busy;
}

/** Runs `listener` each time the board goes from busy to idle. Returns an unsubscribe. */
export function onBoardIdle(listener: () => void) {
  idleListeners.add(listener);
  return () => {
    idleListeners.delete(listener);
  };
}

type SignatureIssue = {
  id: string;
  statusId: string;
  position: number;
  title: string;
  priority: string;
  assignee: { id: string } | null;
};

/** A cheap fingerprint of what the board shows, to tell a real change from an identical refresh. */
export function boardSignature(issues: SignatureIssue[]): string {
  return issues
    .map((i) => `${i.id}|${i.statusId}|${i.position}|${i.title}|${i.priority}|${i.assignee?.id ?? ""}`)
    .sort()
    .join("\n");
}
