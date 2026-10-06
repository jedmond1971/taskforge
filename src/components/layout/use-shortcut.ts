"use client";

import { useEffect, useRef } from "react";
import { shouldIgnoreShortcut } from "@/lib/shortcuts";

/**
 * Registers a single-key shortcut with the shared suppression rules. `key` is
 * matched case-insensitively against `e.key` (so "?" works, and Shift is allowed).
 * The handler runs only when `enabled`, and preventDefault is called only then.
 */
export function useShortcut(key: string, handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const wanted = key.toLowerCase();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== wanted || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      handlerRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
