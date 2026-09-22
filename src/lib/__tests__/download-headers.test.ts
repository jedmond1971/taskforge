import { describe, it, expect } from "vitest";
import { downloadHeaders } from "@/lib/download-headers";

// SECH-125: only deliberately-previewed types render inline, always with a pinned type.
describe("downloadHeaders", () => {
  it("serves raster images and PDF inline with their own type", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]) {
      const h = downloadHeaders(t, "f");
      expect(h.ResponseContentType).toBe(t);
      expect(h.ResponseContentDisposition.startsWith("inline;")).toBe(true);
    }
  });

  it("forces everything else to download as opaque bytes", () => {
    for (const t of ["image/svg+xml", "text/html", "text/plain", "text/csv", "application/zip", "", undefined]) {
      const h = downloadHeaders(t, "f");
      expect(h.ResponseContentType).toBe("application/octet-stream");
      expect(h.ResponseContentDisposition.startsWith("attachment;")).toBe(true);
    }
  });

  it("encodes the file name without allowing header injection", () => {
    const h = downloadHeaders("text/plain", 'évil"; x=1\r\nSet-Cookie: a=b.txt');
    expect(h.ResponseContentDisposition).not.toMatch(/[\r\n]/);
    expect(h.ResponseContentDisposition).toMatch(/^attachment; filename="[A-Za-z0-9._ -]+"; filename\*=UTF-8''/);
    expect(h.ResponseContentDisposition).toContain(encodeURIComponent("évil"));
  });
});
