import mammoth from "mammoth";
import { putObject } from "@/lib/s3";
import { sanitizeDocxPreviewHtml } from "@/lib/sanitize-html";

// Converts a DOCX buffer to sanitized HTML for in-app preview. Embedded
// images are extracted and uploaded to S3, then referenced via the app's
// image proxy route rather than a raw/presigned S3 URL, since presigned
// URLs expire and would go stale in the cached HTML.
// Returns null (rather than throwing) on conversion failure so callers can
// fall back to the download-only view without erroring the whole request.
export async function convertDocxToPreviewHtml(
  buffer: Buffer,
  docSpaceId: string,
  pageId: string,
  projectKey: string
): Promise<string | null> {
  try {
    let imageIndex = 0;

    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const contentType = image.contentType || "image/png";
          const ext = contentType.split("/")[1]?.split("+")[0] || "png";
          const imgBuffer = await image.read("base64");
          const bin = Buffer.from(imgBuffer, "base64");
          const key = `docs/${docSpaceId}/${pageId}/docx-images/${crypto.randomUUID()}-${imageIndex++}.${ext}`;
          await putObject(key, bin, contentType);
          return { src: `/api/docs/${projectKey}/pages/${pageId}/images/${encodeURIComponent(key)}` };
        }),
      }
    );

    return sanitizeDocxPreviewHtml(result.value);
  } catch (error) {
    console.error(`DOCX preview conversion failed for page ${pageId}:`, error);
    return null;
  }
}
