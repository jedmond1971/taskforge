"use client";

import { useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { acceptInviteNewUser, acceptInviteExistingUser } from "./actions";

type Mode = "new-user" | "existing-matching" | "existing-mismatch" | "needs-login";

interface Props {
  token: string;
  orgName: string;
  email: string;
  mode: Mode;
  currentSessionEmail: string | null;
}

const accentLine = (
  <div
    className="absolute top-0 rounded-sm"
    style={{
      left: "10%",
      right: "10%",
      height: "1px",
      background: "linear-gradient(90deg, transparent, rgba(240,90,40,0.55), transparent)",
    }}
  />
);

const inputClass =
  "w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[44px]";

const primaryBtn =
  "w-full py-2.5 px-4 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-opacity text-sm mt-2 min-h-[44px]";

export function InviteAcceptClient({ token, orgName, email, mode, currentSessionEmail }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleNewUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const name = fd.get("name") as string;
      const password = fd.get("password") as string;

      const result = await acceptInviteNewUser(token, name, password);
      if (!result.success) {
        setError(result.error ?? "Something went wrong.");
        return;
      }

      const signInResult = await signIn("credentials", { email, password, redirect: false });
      if (signInResult?.error) {
        setError("Account created, but sign-in failed. Please go to the login page.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExistingUser() {
    setError(null);
    setLoading(true);
    try {
      const result = await acceptInviteExistingUser(token);
      if (!result.success) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      await update({});
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full flex flex-col items-center justify-center gap-6 px-4 sm:px-6 py-8">
      <img src="/logo-light.png" alt="JedForge" className="w-[200px] sm:w-[260px] h-auto block dark:hidden" />
      <img src="/logo-dark.png" alt="JedForge" className="w-[200px] sm:w-[260px] h-auto hidden dark:block" />

      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
        {accentLine}

        {mode === "new-user" && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">
                You&apos;ve been invited
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                Create your account to join <strong className="text-zinc-700 dark:text-zinc-300">{orgName}</strong>
              </p>
            </div>

            <form onSubmit={handleNewUser} className="space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className={`${inputClass} opacity-60 cursor-not-allowed`}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Full name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Jane Smith"
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  minLength={8}
                  className={inputClass}
                />
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Minimum 8 characters</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={primaryBtn}
                style={{ background: "#f05a28" }}
              >
                {loading ? "Creating account…" : "Create account & join"}
              </button>
            </form>
          </>
        )}

        {mode === "existing-matching" && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">
                Join {orgName}
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                You&apos;re signed in as <strong className="text-zinc-700 dark:text-zinc-300">{currentSessionEmail}</strong>
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm mb-4">
                {error}
              </div>
            )}

            <button
              onClick={handleExistingUser}
              disabled={loading}
              className={primaryBtn}
              style={{ background: "#f05a28" }}
            >
              {loading ? "Joining…" : "Join Organization"}
            </button>
          </>
        )}

        {mode === "existing-mismatch" && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">
                Wrong account
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                This invite was sent to <strong className="text-zinc-700 dark:text-zinc-300">{email}</strong>,
                but you&apos;re signed in as <strong className="text-zinc-700 dark:text-zinc-300">{currentSessionEmail}</strong>.
              </p>
            </div>

            <button
              onClick={() => signOut({ callbackUrl: `/invite/${token}` })}
              className={primaryBtn}
              style={{ background: "#f05a28" }}
            >
              Log out
            </button>
          </>
        )}

        {mode === "needs-login" && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">
                Log in to accept
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                An account already exists for <strong className="text-zinc-700 dark:text-zinc-300">{email}</strong>.
                Log in to accept this invite.
              </p>
            </div>

            <a
              href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
              className={`${primaryBtn} flex items-center justify-center no-underline`}
              style={{ background: "#f05a28" }}
            >
              Log in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
