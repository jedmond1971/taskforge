import Link from "next/link";

export default function RegisterPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 sm:px-6">
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
        <div
          className="absolute top-0 rounded-sm"
          style={{
            left: "10%",
            right: "10%",
            height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(240,90,40,0.55), transparent)",
          }}
        />
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            Account Registration Unavailable
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            Account creation is managed by your administrator.
            Please contact them to request access.
          </p>
          <Link
            href="/login"
            className="inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium underline underline-offset-4"
          >
            Return to login
          </Link>
        </div>
      </div>
    </div>
  );
}
