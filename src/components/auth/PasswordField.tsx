"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const inputClass =
  "w-full pl-3 pr-11 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm min-h-[44px]";

interface PasswordFieldProps {
  id: string;
  name: string;
  label: string;
  /** `current-password` for sign-in, `new-password` when choosing one, so password managers do the right thing. */
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  /** Rendered on the label row, right-aligned (e.g. a "Forgot password?" link). */
  labelAside?: React.ReactNode;
  describedBy?: string;
}

// Uncontrolled on purpose: the surrounding forms read it from FormData, and a controlled value
// would re-render the form on every keystroke for no benefit.
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  placeholder = "••••••••",
  minLength,
  maxLength,
  labelAside,
  describedBy,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby={describedBy}
          // A visible password is still a password: keep spellcheck/capitalisation from touching it.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
