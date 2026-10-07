// Logo + card used by the password-reset pages. The login page keeps its own sparks backdrop.
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-full flex flex-col items-center justify-center gap-6 px-4 sm:px-6 py-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-light.png" alt="JedForge" className="w-[200px] sm:w-[260px] h-auto block dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="JedForge" className="w-[200px] sm:w-[260px] h-auto hidden dark:block" />
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">{title}</h1>
          {subtitle && <p className="text-zinc-500 dark:text-zinc-400 text-sm">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
