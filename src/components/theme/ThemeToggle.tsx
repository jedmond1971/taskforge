"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const CYCLE: Array<"dark" | "light" | "system"> = ["dark", "light", "system"];

const LABELS: Record<string, string> = {
  dark: "Dark mode",
  light: "Light mode",
  system: "System theme",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycle() {
    const idx = CYCLE.indexOf(theme);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setTheme(next);
  }

  return (
    <button
      onClick={cycle}
      aria-label={LABELS[theme]}
      title={LABELS[theme]}
      className="relative p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
    >
      {theme === "dark" && <Moon className="w-4 h-4 transition-transform duration-150" />}
      {theme === "light" && <Sun className="w-4 h-4 transition-transform duration-150" />}
      {theme === "system" && <Monitor className="w-4 h-4 transition-transform duration-150" />}
    </button>
  );
}
