"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateComment, deleteComment } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { Pencil, Trash2, Check, X, MessageSquare } from "lucide-react";
import { toast } from "sonner";

type Comment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
};

interface CommentThreadProps {
  comments: Comment[];
  projectKey: string;
  currentUserId: string;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function CommentItem({
  comment,
  projectKey,
  isAuthor,
}: {
  comment: Comment;
  projectKey: string;
  isAuthor: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!editBody.trim()) return;
    startTransition(async () => {
      try {
        await updateComment(projectKey, comment.id, editBody);
        toast.success("Comment updated");
        setEditing(false);
        router.refresh();
      } catch {
        toast.error("Failed to update comment");
      }
    });
  }

  function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    startTransition(async () => {
      try {
        await deleteComment(projectKey, comment.id);
        toast.success("Comment deleted");
        router.refresh();
      } catch {
        toast.error("Failed to delete comment");
      }
    });
  }

  const initial = comment.author.name.charAt(0).toUpperCase();

  return (
    <div className="flex gap-3 group animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">{initial}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{comment.author.name}</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600">{timeAgo(comment.createdAt)}</span>
          {comment.updatedAt > comment.createdAt && (
            <span className="text-xs text-zinc-400 dark:text-zinc-700 italic">(edited)</span>
          )}
          {isAuthor && !editing && (
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setEditing(true)}
                className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 rounded"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={isPending || !editBody.trim()}
                className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg disabled:opacity-50"
              >
                <Check className="w-3 h-3" /> Save
              </button>
              <button
                onClick={() => { setEditBody(comment.body); setEditing(false); }}
                className="flex items-center gap-1 px-3 py-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700 rounded-lg"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
    </div>
  );
}

export function CommentThread({ comments, projectKey, currentUserId }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <MessageSquare className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
        <p className="text-sm text-zinc-400 dark:text-zinc-600">No comments yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          projectKey={projectKey}
          isAuthor={comment.author.id === currentUserId}
        />
      ))}
    </div>
  );
}
