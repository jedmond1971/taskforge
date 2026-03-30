import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-zinc-950 text-center p-8">
      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
        <FileQuestion className="w-8 h-8 text-zinc-500" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">404</h1>
        <p className="text-zinc-400 mb-1">Page not found</p>
        <p className="text-sm text-zinc-600">The page you&apos;re looking for doesn&apos;t exist.</p>
      </div>
      <Link href="/">
        <Button className="bg-indigo-600 hover:bg-indigo-500 text-white">Go to dashboard</Button>
      </Link>
    </div>
  );
}
