// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { AutoRefresh } from "../AutoRefresh";
import { setBoardBusy } from "@/lib/board-activity";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  setVisibility("visible");
});
afterEach(() => {
  setBoardBusy(false);
  vi.useRealTimers();
});

const returnToTab = () => document.dispatchEvent(new Event("visibilitychange"));

describe("AutoRefresh (JFR-184)", () => {
  it("still refreshes on the 3-minute interval", () => {
    render(<AutoRefresh />);
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the tab becomes visible after a while, but not on quick returns", () => {
    render(<AutoRefresh />);
    returnToTab(); // opened just now
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(31_000);
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus")); // visibilitychange + focus fire together on a tab switch
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the tab is hidden", () => {
    render(<AutoRefresh />);
    vi.advanceTimersByTime(60_000);
    setVisibility("hidden");
    returnToTab();
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("holds off while the board is busy and refreshes once, when it goes idle", () => {
    render(<AutoRefresh />);
    setBoardBusy(true); // a card is being dragged
    vi.advanceTimersByTime(3 * 60 * 1000); // interval fires mid-drag
    vi.advanceTimersByTime(60_000);
    returnToTab();
    expect(refresh).not.toHaveBeenCalled();

    setBoardBusy(false);
    expect(refresh).toHaveBeenCalledTimes(1);

    setBoardBusy(true);
    setBoardBusy(false); // nothing was deferred this time
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("removes its listeners and timers on unmount", () => {
    const { unmount } = render(<AutoRefresh />);
    unmount();
    vi.advanceTimersByTime(10 * 60 * 1000);
    returnToTab();
    window.dispatchEvent(new Event("focus"));
    setBoardBusy(true);
    setBoardBusy(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
