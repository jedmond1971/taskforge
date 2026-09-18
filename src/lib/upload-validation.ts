export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20 MB

// Allowlist (not blocklist) so a new/unusual mime type is rejected by default
// rather than silently permitted. Kept in one place so the direct-upload path
// (attachments/upload) and the presigned path (attachments/presign) can't
// drift apart on what they consider a safe attachment.
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
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
]);

export function isAllowedAttachmentMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType);
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
