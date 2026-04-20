import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-zinc-500 text-sm mt-1">Manage your account preferences</p>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Change password</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            You&apos;ll be prompted to sign in again after your next session expires.
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
