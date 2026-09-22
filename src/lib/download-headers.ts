/**
 * Response headers baked into every presigned download URL (SECH-125).
 *
 * Objects are served from the bucket origin with whatever Content-Type the uploader
 * declared, so without overrides an active document (SVG with <script>, HTML, text
 * the browser sniffs) renders in the browser when its link is opened. The response-*
 * overrides are part of the signed query string, so they can't be stripped.
 *
 * Only types the app deliberately previews are served inline, and always with a
 * pinned Content-Type; everything else is forced to download as opaque bytes.
 */
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf", // DOCUMENT doc pages preview PDFs in an iframe
]);

export interface DownloadHeaders {
  ResponseContentType: string;
  ResponseContentDisposition: string;
}

export function isInlineSafeType(contentType: string | undefined): boolean {
  return !!contentType && INLINE_SAFE_TYPES.has(contentType);
}

function contentDispositionFileName(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._ -]/g, "_").trim() || "download";
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function downloadHeaders(contentType: string | undefined, fileName: string): DownloadHeaders {
  const inline = isInlineSafeType(contentType);
  return {
    ResponseContentType: inline ? contentType! : "application/octet-stream",
    ResponseContentDisposition: `${inline ? "inline" : "attachment"}; ${contentDispositionFileName(fileName)}`,
  };
}
