export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-zinc-950 flex items-center justify-center">
      {children}
    </div>
  );
}
