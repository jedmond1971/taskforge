"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Paperclip,
  FileText,
  FileImage,
  FileArchive,
  File,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type AttachmentItem = {
  id: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  uploader: { id: string; name: string };
  downloadUrl: string;
};

type UploadingFile = {
  id: string;
  fileName: string;
  progress: number;
};

interface AttachmentsPanelProps {
  issueId: string;
  projectId: string;
  canEdit: boolean;
  currentUserId: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
];

function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.some((t) => mimeType.startsWith(t));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <FileImage className={className} />;
  if (mimeType === "application/zip" || mimeType === "application/x-zip-compressed")
    return <FileArchive className={className} />;
  if (mimeType === "application/pdf" || mimeType.includes("word") || mimeType.includes("text"))
    return <FileText className={className} />;
  return <File className={className} />;
}

export function AttachmentsPanel({
  issueId,
  canEdit,
  currentUserId,
}: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/attachments?issueId=${issueId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.attachments) setAttachments(data.attachments);
      })
      .catch(() => toast.error("Failed to load attachments"))
      .finally(() => setLoading(false));
  }, [issueId]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!isAllowedMimeType(file.type)) {
        toast.error(`${file.name}: file type not allowed`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: exceeds 20 MB limit`);
        return;
      }

      const uploadId = crypto.randomUUID();
      setUploading((prev) => [...prev, { id: uploadId, fileName: file.name, progress: 0 }]);

      try {
        // 1. Get presigned URL + create DB record
        const presignRes = await fetch("/api/attachments/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json() as { error: string };
          throw new Error(err.error ?? "Presign failed");
        }
        const { uploadUrl, attachmentId } = await presignRes.json() as {
          uploadUrl: string;
          key: string;
          attachmentId: string;
        };

        // 2. PUT directly to S3 via XHR for progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploading((prev) =>
                prev.map((u) => (u.id === uploadId ? { ...u, progress: pct } : u))
              );
            }
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(file);
        });

        // 3. Confirm upload + log activity
        const confirmRes = await fetch("/api/attachments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentId }),
        });
        if (!confirmRes.ok) throw new Error("Confirm failed");
        const { attachment } = await confirmRes.json() as { attachment: AttachmentItem };

        setAttachments((prev) => [...prev, attachment]);
        toast.success(`${file.name} uploaded`);
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`);
      } finally {
        setUploading((prev) => prev.filter((u) => u.id !== uploadId));
      }
    },
    [issueId]
  );

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(uploadFile);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleDelete(attachment: AttachmentItem) {
    if (!confirm(`Remove attachment "${attachment.fileName}"?`)) return;
    try {
      const res = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error);
      }
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      toast.success("Attachment removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const canDelete = (attachment: AttachmentItem) =>
    canEdit || attachment.uploader.id === currentUserId;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5" />
          Attachments
          {attachments.length > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
              {attachments.length}
            </span>
          )}
        </h3>
        {canEdit && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300"
          >
            <Upload className="w-3 h-3" />
            Attach files
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
      />

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {canEdit && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-xs cursor-pointer transition-colors ${
                dragOver
                  ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Drop files here or click to browse · max 20 MB
            </div>
          )}

          {uploading.map((u) => (
            <div
              key={u.id}
              className="mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
            >
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
                  {u.fileName}
                </span>
                <span className="text-zinc-400 ml-2 shrink-0">{u.progress}%</span>
              </div>
              <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-150"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            </div>
          ))}

          {attachments.length === 0 && uploading.length === 0 && (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">No attachments yet.</p>
          )}

          <div className="space-y-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                {a.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.downloadUrl}
                    alt={a.fileName}
                    className="w-10 h-10 object-cover rounded flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center rounded bg-zinc-100 dark:bg-zinc-800 flex-shrink-0">
                    <FileIcon mimeType={a.mimeType} className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <a
                    href={a.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-zinc-800 dark:text-zinc-200 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium truncate block"
                  >
                    {a.fileName}
                  </a>
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">
                    {formatBytes(a.fileSize)} · {a.uploader.name} ·{" "}
                    {new Date(a.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {canDelete(a) && (
                  <button
                    onClick={() => handleDelete(a)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="Remove attachment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
