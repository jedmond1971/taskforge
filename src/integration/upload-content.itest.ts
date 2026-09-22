import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as attachmentUpload from "@/app/api/attachments/upload/route";
import * as attachmentPresign from "@/app/api/attachments/presign/route";
import * as editorImages from "@/app/api/editor-images/route";
import * as avatarRoute from "@/app/api/avatar/route";

/**
 * SECH-125: an authorised editor still cannot store an active document (SVG) through any
 * upload path, and a real raster image still goes through. Runs the real route handlers as
 * a TEAM_MEMBER of Org A's project; S3 is stubbed by setup.ts.
 */

let w: World;
let png: Buffer;
beforeAll(async () => {
  w = await createWorld();
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0f0" } }).png().toBuffer();
});
afterAll(async () => { await destroyWorld(w); });

// Sized on purpose: sharp only decodes an SVG with dimensions, and a decodable SVG is
// exactly what slipped past the old "does sharp decode it?" check.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(document.domain)</script><rect width="10" height="10"/></svg>';
const url = (path: string) => `http://localhost${path}`;

function uploadForm(bytes: Buffer | string, name: string, type: string, issueId?: string) {
  const form = new FormData();
  if (issueId) form.append("issueId", issueId);
  form.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type }));
  return form;
}
const attachmentCount = () => prisma.attachment.count({ where: { issueId: w.A.issue.id } });

describe("attachment uploads", () => {
  it("rejects SVG declared as SVG, and SVG bytes disguised as PNG, storing nothing", async () => {
    actAs(w.users.aMember);
    const before = await attachmentCount();
    for (const [name, type] of [["x.svg", "image/svg+xml"], ["x.png", "image/png"]]) {
      const res = await attachmentUpload.POST(
        new NextRequest(url("/api/attachments/upload"), { method: "POST", body: uploadForm(SVG, name, type, w.A.issue.id) })
      );
      expect(res.status, `${name} as ${type}`).toBe(400);
    }
    expect(await attachmentCount()).toBe(before);
  });

  it("still accepts a real PNG", async () => {
    actAs(w.users.aMember);
    const res = await attachmentUpload.POST(
      new NextRequest(url("/api/attachments/upload"), { method: "POST", body: uploadForm(png, "ok.png", "image/png", w.A.issue.id) })
    );
    expect(res.status).toBe(200);
    const { attachment } = await res.json();
    expect(attachment.mimeType).toBe("image/png");
  });

  it("refuses to presign an SVG upload", async () => {
    actAs(w.users.aMember);
    const res = await attachmentPresign.POST(
      new NextRequest(url("/x"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueId: w.A.issue.id, fileName: "x.svg", fileSize: SVG.length, mimeType: "image/svg+xml" }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("editor images", () => {
  it("rejects SVG and stores a real PNG under a verified .png key", async () => {
    actAs(w.users.aMember);
    const svg = await editorImages.POST(
      new NextRequest(url("/api/editor-images"), { method: "POST", body: uploadForm(SVG, "x.svg", "image/svg+xml") })
    );
    expect(svg.status).toBe(400);
    const disguised = await editorImages.POST(
      new NextRequest(url("/api/editor-images"), { method: "POST", body: uploadForm(SVG, "x.png", "image/png") })
    );
    expect(disguised.status).toBe(400);

    const ok = await editorImages.POST(
      new NextRequest(url("/api/editor-images"), { method: "POST", body: uploadForm(png, "shot.svg", "image/png") })
    );
    expect(ok.status).toBe(200);
    // extension comes from the verified bytes, not the client's file name
    expect((await ok.json()).url).toMatch(/editor-images%2F[0-9a-f-]+\.png$/);
  });
});

describe("avatar", () => {
  it("rejects SVG before it reaches the image decoder", async () => {
    actAs(w.users.aMember);
    const res = await avatarRoute.PUT(
      new NextRequest(url("/api/avatar"), {
        method: "PUT",
        headers: { "content-type": "image/svg+xml", "content-length": String(SVG.length) },
        body: SVG,
      })
    );
    expect(res.status).toBe(400);
  });
});
