import Link from "next/link";
import { FileSearch } from "lucide-react";

export default function IssueNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
        <FileSearch className="w-7 h-7 text-zinc-500" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Issue not found</h2>
        <p className="text-sm text-zinc-500">This issue may have been deleted or you don&apos;t have access.</p>
      </div>
      <Link href="../../issues" className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors">
        ← Back to issues
      </Link>
    </div>
  );
}
