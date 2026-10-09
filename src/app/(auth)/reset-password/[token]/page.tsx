import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { findValidResetToken } from "@/lib/password-reset";
import { ResetPasswordForm } from "./ResetPasswordForm";

// The URL is a bearer secret: keep it out of Referer headers and search indexes.
export const metadata: Metadata = {
  title: "Reset password",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // 256-bit tokens can't be enumerated, so checking on render (for a better message than a form that
  // can only fail) needs no rate limit; the action that actually changes anything is limited.
  if (!(await findValidResetToken(token))) {
    return (
      <AuthShell title="Link expired" subtitle="This reset link is invalid, has expired, or was already used.">
        <Link
          href="/forgot-password"
          className="block w-full py-2.5 px-4 bg-primary hover:opacity-90 text-primary-foreground font-medium rounded-lg text-sm text-center"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return <ResetPasswordForm token={token} />;
}
