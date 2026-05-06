"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { toast } from "sonner";

interface CommentFormProps {
  projectKey: string;
  issueId: string;
  currentUserName: string;
  currentUserInitial: string;
}

export function CommentForm({ projectKey, issueId, currentUserInitial }: CommentFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!body.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await addComment(projectKey, issueId, body);
        toast.success("Comment posted");
        setBody("");
        router.refresh();
      } catch (err) {
        toast.error("Failed to post comment");
        setError(err instanceof Error ? err.message : "Failed to post comment");
      }
    });
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center flex-shrink-0 mt-1">
        <span className="text-xs text-white font-semibold">{currentUserInitial}</span>
      </div>
      <div className="flex-1 space-y-2">
        {error && (
          <p className="text-red-600 dark:text-red-400 text-xs">{error}</p>
        )}
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder="Leave a comment..."
          minHeight="80px"
          disabled={isPending}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-400 dark:text-zinc-600">Ctrl+Enter to submit</p>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !body.trim()}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
          >
            {isPending ? "Posting..." : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
