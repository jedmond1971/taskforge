"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { resetPassword } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const result = await resetPassword(token, password);
      if (result.success) setDone(true);
      else setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // The shell lives here (not in the page) so its heading can follow the state.
  if (done) {
    return (
      <AuthShell title="Password changed">
        <div className="space-y-4">
          <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
            Your password has been changed and you&apos;ve been signed out everywhere. Sign in with your new password.
          </p>
          <Link
            href="/login"
            className="block w-full py-2.5 px-4 bg-primary hover:opacity-90 text-primary-foreground font-medium rounded-lg text-sm text-center"
          >
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out of every device.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
            {error}{" "}
            {/invalid or has expired/.test(error) && (
              <Link href="/forgot-password" className="underline">
                Request a new link
              </Link>
            )}
          </div>
        )}
        <PasswordField
          id="password"
          name="password"
          label="New password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          describedBy="password-hint"
        />
        <p id="password-hint" className="text-xs text-zinc-500 -mt-2">
          At least {PASSWORD_MIN_LENGTH} characters.
        </p>
        <PasswordField
          id="confirm"
          name="confirm"
          label="Confirm new password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-primary hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-opacity text-sm min-h-[44px]"
        >
          {loading ? "Saving..." : "Change password"}
        </button>
      </form>
    </AuthShell>
  );
}
