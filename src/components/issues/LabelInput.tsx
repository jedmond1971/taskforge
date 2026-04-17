"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { X } from "lucide-react";

const LABEL_COLORS = [
  "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
  "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800",
  "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800",
];

export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) & 0xffffffff;
  }
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

interface LabelInputProps {
  labels: string[];
  onChange: (labels: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function LabelInput({ labels, onChange, placeholder = "Add label...", disabled }: LabelInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addLabel(raw: string) {
    const label = raw.trim().toLowerCase();
    if (!label || labels.includes(label)) {
      setInputValue("");
      return;
    }
    onChange([...labels, label]);
    setInputValue("");
  }

  function removeLabel(label: string) {
    onChange(labels.filter((l) => l !== label));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLabel(inputValue);
    } else if (e.key === ",") {
      e.preventDefault();
      addLabel(inputValue);
    } else if (e.key === "Backspace" && !inputValue && labels.length > 0) {
      removeLabel(labels[labels.length - 1]);
    }
  }

  function handleBlur() {
    if (inputValue.trim()) addLabel(inputValue);
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 items-center min-h-[38px] px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg cursor-text"
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {labels.map((label) => (
        <span
          key={label}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${labelColor(label)}`}
        >
          {label}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeLabel(label); }}
              className="hover:opacity-70 transition-opacity ml-0.5"
              aria-label={`Remove ${label}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={labels.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none"
        />
      )}
    </div>
  );
}
