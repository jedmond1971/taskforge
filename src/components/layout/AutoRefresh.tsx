"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isBoardBusy, onBoardIdle } from "@/lib/board-activity";

const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
// Returning to a tab refreshes it, but not if it was refreshed this recently (a tab switch fires
// both `visibilitychange` and `focus`, and quick alt-tabbing shouldn't hammer the server).
const FOCUS_REFRESH_MIN_GAP_MS = 30 * 1000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = Date.now();
    let deferred = false;

    function refresh() {
      // Mid-drag or mid-save: hold off and catch up as soon as the board goes idle.
      if (isBoardBusy()) {
        deferred = true;
        return;
      }
      deferred = false;
      lastRefresh = Date.now();
      router.refresh();
    }

    function onReturn() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh < FOCUS_REFRESH_MIN_GAP_MS) return;
      refresh();
    }

    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    const stopIdleWatch = onBoardIdle(() => {
      if (deferred) refresh();
    });

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      stopIdleWatch();
    };
  }, [router]);

  return null;
}
