import { describe, it, expect, vi, afterEach } from "vitest";
import { boardSignature, isBoardBusy, onBoardIdle, setBoardBusy } from "@/lib/board-activity";

afterEach(() => setBoardBusy(false));

describe("board busy signal (JFR-184)", () => {
  it("notifies idle listeners only when the board goes from busy to idle", () => {
    const idle = vi.fn();
    const stop = onBoardIdle(idle);

    setBoardBusy(false); // already idle: nothing to announce
    expect(idle).not.toHaveBeenCalled();

    setBoardBusy(true);
    expect(isBoardBusy()).toBe(true);
    setBoardBusy(true); // repeat is not a transition
    expect(idle).not.toHaveBeenCalled();

    setBoardBusy(false);
    expect(isBoardBusy()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops notifying once unsubscribed", () => {
    const idle = vi.fn();
    onBoardIdle(idle)();
    setBoardBusy(true);
    setBoardBusy(false);
    expect(idle).not.toHaveBeenCalled();
  });
});

describe("boardSignature", () => {
  const issue = (over: Partial<Parameters<typeof boardSignature>[0][number]> = {}) => ({
    id: "a", statusId: "s1", position: 0, title: "T", priority: "LOW", assignee: null, ...over,
  });

  it("is stable across ordering and identical data", () => {
    expect(boardSignature([issue({ id: "a" }), issue({ id: "b" })])).toBe(
      boardSignature([issue({ id: "b" }), issue({ id: "a" })])
    );
  });

  it.each([
    ["status", { statusId: "s2" }],
    ["position", { position: 1 }],
    ["title", { title: "Other" }],
    ["priority", { priority: "HIGH" }],
    ["assignee", { assignee: { id: "u1" } }],
  ])("changes when the %s changes", (_name, change) => {
    expect(boardSignature([issue(change)])).not.toBe(boardSignature([issue()]));
  });

  it("changes when an issue appears or disappears", () => {
    expect(boardSignature([issue()])).not.toBe(boardSignature([]));
  });
});
