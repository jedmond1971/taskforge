import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as docsRoot from "@/app/api/docs/[projectKey]/route";
import * as docsPages from "@/app/api/docs/[projectKey]/pages/route";
import * as docsPage from "@/app/api/docs/[projectKey]/pages/[pageId]/route";
import * as docsSections from "@/app/api/docs/[projectKey]/sections/route";
import * as docsSection from "@/app/api/docs/[projectKey]/sections/[sectionId]/route";
import * as docsSearch from "@/app/api/docs/[projectKey]/search/route";
import * as docsRevisions from "@/app/api/docs/[projectKey]/pages/[pageId]/revisions/route";
import * as docsLinks from "@/app/api/docs/[projectKey]/pages/[pageId]/links/route";
import * as docsFile from "@/app/api/docs/[projectKey]/pages/[pageId]/file/route";
import * as docsImage from "@/app/api/docs/[projectKey]/pages/[pageId]/images/[imageKey]/route";
import * as attachments from "@/app/api/attachments/route";
import * as attachmentById from "@/app/api/attachments/[id]/route";
import * as attachmentUrl from "@/app/api/attachments/[id]/url/route";
import * as attachmentPresign from "@/app/api/attachments/presign/route";
import * as attachmentConfirm from "@/app/api/attachments/confirm/route";
import * as attachmentUpload from "@/app/api/attachments/upload/route";
import * as issueRoute from "@/app/api/issues/[issueId]/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as avatarRoute from "@/app/api/avatar/route";
import * as editorImages from "@/app/api/editor-images/route";

/**
 * SECH-85: negative tests for the session-authenticated API routes (/api/docs, /api/attachments,
 * /api/issues, /api/projects, ...). Handlers are invoked directly with a real database.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const url = (path: string) => `http://localhost${path}`;
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(url(path), { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const status = async (p: Promise<Response>) => (await p).status;

describe("private docs of another org are invisible and immutable", () => {
  it("every /api/docs route answers 404 for a non-member and Org A's docs stay unchanged", async () => {
    actAs(w.users.bMember);
    const k = w.keyA, pg = w.A.page.id, sec = w.A.section.id;
    const pp = params({ projectKey: k });
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["GET docspace", () => docsRoot.GET(json("GET", `/api/docs/${k}`), pp)],
      ["PATCH docspace (make public)", () => docsRoot.PATCH(json("PATCH", `/api/docs/${k}`, { isPublic: true }), pp)],
      ["GET pages", () => docsPages.GET(json("GET", `/api/docs/${k}/pages`), pp)],
      ["POST page", () => docsPages.POST(json("POST", `/api/docs/${k}/pages`, { title: "pwn", content: "<p>pwn</p>" }), pp)],
      ["GET page", () => docsPage.GET(json("GET", "/x"), params({ projectKey: k, pageId: pg }))],
      ["PATCH page", () => docsPage.PATCH(json("PATCH", "/x", { title: "pwn" }), params({ projectKey: k, pageId: pg }))],
      ["DELETE page", () => docsPage.DELETE(json("DELETE", "/x"), params({ projectKey: k, pageId: pg }))],
      ["GET sections", () => docsSections.GET(json("GET", "/x"), pp)],
      ["POST section", () => docsSections.POST(json("POST", "/x", { title: "pwn" }), pp)],
      ["PATCH section", () => docsSection.PATCH(json("PATCH", "/x", { title: "pwn" }), params({ projectKey: k, sectionId: sec }))],
      ["DELETE section", () => docsSection.DELETE(json("DELETE", "/x"), params({ projectKey: k, sectionId: sec }))],
      ["GET search", () => docsSearch.GET(json("GET", `/api/docs/${k}/search?q=secret`), pp)],
      ["GET revisions", () => docsRevisions.GET(json("GET", "/x"), params({ projectKey: k, pageId: pg }))],
      ["GET links", () => docsLinks.GET(json("GET", "/x"), params({ projectKey: k, pageId: pg }))],
      ["GET file", () => docsFile.GET(json("GET", "/x"), params({ projectKey: k, pageId: pg }))],
      ["GET image", () => docsImage.GET(json("GET", "/x"), params({ projectKey: k, pageId: pg, imageKey: "x" }))],
    ];
    for (const [name, attempt] of attempts) {
      expect(await status(attempt()), name).toBe(404);
    }
    const page = await prisma.docPage.findUniqueOrThrow({ where: { id: pg } });
    expect(page.title).toBe(`${k} secret page`);
    expect(page.content).toBe("<p>secret</p>");
    expect((await prisma.docSpace.findUniqueOrThrow({ where: { id: w.A.docSpace.id } })).isPublic).toBe(false);
    expect(await prisma.docSection.count({ where: { docSpaceId: w.A.docSpace.id } })).toBe(1);
    expect(await prisma.docPage.count({ where: { docSpaceId: w.A.docSpace.id } })).toBe(1);
  });

  it("a member of the project may not exceed their role in docs", async () => {
    actAs(w.users.aViewer);
    expect(await status(docsPage.PATCH(json("PATCH", "/x", { title: "viewer" }), params({ projectKey: w.keyA, pageId: w.A.page.id })))).toBe(403);
    expect(await status(docsPages.POST(json("POST", "/x", { title: "viewer" }), params({ projectKey: w.keyA })))).toBe(403);
    actAs(w.users.aMember); // TEAM_MEMBER: can edit, cannot delete or publish the space
    expect(await status(docsPage.DELETE(json("DELETE", "/x"), params({ projectKey: w.keyA, pageId: w.A.page.id })))).toBe(403);
    expect(await status(docsSection.DELETE(json("DELETE", "/x"), params({ projectKey: w.keyA, sectionId: w.A.section.id })))).toBe(403);
    expect(await status(docsRoot.PATCH(json("PATCH", "/x", { isPublic: true }), params({ projectKey: w.keyA })))).toBe(403);
    expect(await prisma.docPage.count({ where: { id: w.A.page.id } })).toBe(1);
  });
});

describe("attachments and issues of another org", () => {
  it("are 403 for a non-member and nothing is modified", async () => {
    actAs(w.users.bMember);
    const issueId = w.A.issue.id, attId = w.A.attachment.id;
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    const form = new FormData();
    form.set("issueId", issueId);
    form.set("file", file);
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["GET attachments", () => attachments.GET(json("GET", `/api/attachments?issueId=${issueId}`))],
      ["GET attachment url", () => attachmentUrl.GET(json("GET", "/x"), params({ id: attId }))],
      ["DELETE attachment", () => attachmentById.DELETE(json("DELETE", "/x"), params({ id: attId }))],
      ["POST presign", () => attachmentPresign.POST(json("POST", "/x", { issueId, fileName: "a.pdf", fileSize: 1, mimeType: "application/pdf" }))],
      ["POST confirm", () => attachmentConfirm.POST(json("POST", "/x", { issueId, fileKey: `attachments/${issueId}/x.pdf`, fileName: "a.pdf", fileSize: 1, mimeType: "application/pdf" }))],
      ["POST upload", () => attachmentUpload.POST(new NextRequest(url("/api/attachments/upload"), { method: "POST", body: form }))],
      ["PATCH issue", () => issueRoute.PATCH(json("PATCH", "/x", { title: "pwn" }), params({ issueId }))],
      ["DELETE issue", () => issueRoute.DELETE(json("DELETE", "/x"), params({ issueId }))],
    ];
    for (const [name, attempt] of attempts) {
      expect(await status(attempt()), name).toBe(403);
    }
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issueId } })).title).toBe(`${w.keyA} secret issue`);
    expect(await prisma.attachment.count({ where: { issueId } })).toBe(1);
  });

  it("a VIEWER cannot upload or edit through the API either", async () => {
    actAs(w.users.aViewer);
    const issueId = w.A.issue.id;
    expect(await status(attachmentPresign.POST(json("POST", "/x", { issueId, fileName: "a.pdf", fileSize: 1, mimeType: "application/pdf" })))).toBe(403);
    expect(await status(issueRoute.PATCH(json("PATCH", "/x", { title: "viewer" }), params({ issueId })))).toBe(403);
    expect(await status(issueRoute.DELETE(json("DELETE", "/x"), params({ issueId })))).toBe(403);
  });
});

describe("POST /api/projects cannot create into another org", () => {
  it("ignores a client-supplied orgId and uses the session's org", async () => {
    actAs(w.users.bMember);
    const key = `ITP${w.tag.toUpperCase().replace(/[^A-Z]/g, "X").slice(0, 3)}`;
    const res = await projectsRoute.POST(json("POST", "/api/projects", { name: "mine", key, orgId: w.orgA.id }));
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project.orgId).toBe(w.orgB.id);
    await prisma.project.delete({ where: { id: project.id } });
  });

  it("refuses a session whose org membership no longer exists", async () => {
    actAs({ ...w.users.bMember, orgId: w.orgA.id }); // stale/forged orgId on the session
    const res = await projectsRoute.POST(json("POST", "/api/projects", { name: "x", key: `ITZ${w.tag.slice(0, 2).toUpperCase()}` }));
    expect(res.status).toBe(403);
  });
});

describe("no session => 401 on every session-authenticated route", () => {
  it("rejects anonymous callers", async () => {
    actAsNobody();
    const pp = params({ projectKey: w.keyB });
    const pg = params({ projectKey: w.keyB, pageId: w.B.page.id });
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["docs GET", () => docsRoot.GET(json("GET", "/x"), pp)],
      ["docs pages POST", () => docsPages.POST(json("POST", "/x", { title: "a" }), pp)],
      ["docs page PATCH", () => docsPage.PATCH(json("PATCH", "/x", { title: "a" }), pg)],
      ["docs page DELETE", () => docsPage.DELETE(json("DELETE", "/x"), pg)],
      ["docs search", () => docsSearch.GET(json("GET", "/x?q=a"), pp)],
      ["attachments GET", () => attachments.GET(json("GET", `/api/attachments?issueId=${w.B.issue.id}`))],
      ["attachments presign", () => attachmentPresign.POST(json("POST", "/x", {}))],
      ["issues PATCH", () => issueRoute.PATCH(json("PATCH", "/x", {}), params({ issueId: w.B.issue.id }))],
      ["projects POST", () => projectsRoute.POST(json("POST", "/x", {}))],
      ["avatar GET", () => avatarRoute.GET(json("GET", "/api/avatar?key=avatars/x.jpg") as NextRequest)],
      ["editor-images GET", () => editorImages.GET(json("GET", "/api/editor-images?key=editor-images/x.png") as NextRequest)],
    ];
    for (const [name, attempt] of attempts) {
      expect(await status(attempt()), name).toBe(401);
    }
  });
});

describe("SECH-85 regressions: docs writes stay inside their own docspace and are sanitized", () => {
  it("PATCH page rejects a sectionId from another docspace", async () => {
    actAs(w.users.bMember);
    const res = await docsPage.PATCH(
      json("PATCH", "/x", { sectionId: w.A.section.id }),
      params({ projectKey: w.keyB, pageId: w.B.page.id })
    );
    expect(res.status).toBe(400);
    expect((await prisma.docPage.findUniqueOrThrow({ where: { id: w.B.page.id } })).sectionId).toBe(w.B.section.id);
    expect(await prisma.docPage.count({ where: { sectionId: w.A.section.id } })).toBe(1); // only A's own page
  });

  it("PATCH page still accepts its own section and null", async () => {
    actAs(w.users.bMember);
    const pp = params({ projectKey: w.keyB, pageId: w.B.page.id });
    expect((await docsPage.PATCH(json("PATCH", "/x", { sectionId: null }), pp)).status).toBe(200);
    expect((await docsPage.PATCH(json("PATCH", "/x", { sectionId: w.B.section.id }), pp)).status).toBe(200);
  });

  it("POST page sanitizes TipTap HTML (stored XSS)", async () => {
    actAs(w.users.bMember);
    const res = await docsPages.POST(
      json("POST", "/x", { title: "xss", content: '<p>hi</p><img src=x onerror="alert(1)"><script>alert(2)</script>' }),
      params({ projectKey: w.keyB })
    );
    expect(res.status).toBe(201);
    const { page } = await res.json();
    const stored = await prisma.docPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.content).toContain("<p>hi</p>");
    expect(stored.content).not.toMatch(/onerror|<script|alert\(/i);
  });

  it("the docx image proxy refuses keys that escape the page's image prefix", async () => {
    actAs(w.users.bMember);
    const escape = `docs/${w.B.docSpace.id}/${w.B.page.id}/docx-images/../../${w.A.docSpace.id}/${w.A.page.id}/secret.png`;
    const res = await docsImage.GET(
      json("GET", "/x"),
      params({ projectKey: w.keyB, pageId: w.B.page.id, imageKey: encodeURIComponent(escape) })
    );
    expect(res.status).toBe(404);
  });
});

describe("SECH-93: closed projects write-lock doc routes (platform admin bypasses)", () => {
  it("blocks TEAM_MEMBER and PROJECT_LEAD doc writes while closed, but reads and admin writes still work", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    try {
      const pp = params({ projectKey: w.keyA });
      const pg = params({ projectKey: w.keyA, pageId: w.A.page.id });
      const sec = params({ projectKey: w.keyA, sectionId: w.A.section.id });

      actAs(w.users.aMember); // TEAM_MEMBER: can normally edit pages/sections
      const memberAttempts: Array<[string, () => Promise<Response>]> = [
        ["POST page", () => docsPages.POST(json("POST", "/x", { title: "pwn" }), pp)],
        ["PATCH page", () => docsPage.PATCH(json("PATCH", "/x", { title: "pwn" }), pg)],
        ["POST section", () => docsSections.POST(json("POST", "/x", { title: "pwn" }), pp)],
        ["PATCH section", () => docsSection.PATCH(json("PATCH", "/x", { title: "pwn" }), sec)],
      ];
      for (const [name, attempt] of memberAttempts) {
        expect(await status(attempt()), name).toBe(403);
      }

      actAs(w.users.aOwner); // PROJECT_LEAD: can normally delete/publish
      const leadAttempts: Array<[string, () => Promise<Response>]> = [
        ["DELETE page", () => docsPage.DELETE(json("DELETE", "/x"), pg)],
        ["DELETE section", () => docsSection.DELETE(json("DELETE", "/x"), sec)],
        ["PATCH docspace", () => docsRoot.PATCH(json("PATCH", "/x", { isPublic: true }), pp)],
      ];
      for (const [name, attempt] of leadAttempts) {
        expect(await status(attempt()), name).toBe(403);
      }

      // Docs remain readable while closed (closed-project invariant #3) — only writes are locked.
      actAs(w.users.aMember);
      expect((await docsRoot.GET(json("GET", "/x"), pp)).status).toBe(200);
      expect((await docsPage.GET(json("GET", "/x"), pg)).status).toBe(200);

      // Platform admin bypasses the write-lock, mirroring the closed-project UI gate.
      actAs(w.users.aAdmin);
      const created = await docsPages.POST(json("POST", "/x", { title: "admin edit while closed" }), pp);
      expect(created.status).toBe(201);
      const { page: newPage } = await created.json();
      await prisma.docPage.delete({ where: { id: newPage.id } });

      const page = await prisma.docPage.findUniqueOrThrow({ where: { id: w.A.page.id } });
      expect(page.title).toBe(`${w.keyA} secret page`);
    } finally {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });
});

describe("public docspaces are public to the owning org only (SECH-95)", () => {
  it("a same-org non-member can read a public docspace; another org's user cannot", async () => {
    const pp = params({ projectKey: w.keyA });
    const pg = params({ projectKey: w.keyA, pageId: w.A.page.id });
    const outsider = await prisma.user.create({
      data: { name: "org-a non-member", email: `${w.tag}-a-nonmember@itest.local`, passwordHash: "x" },
    });
    await prisma.orgMember.create({ data: { orgId: w.orgA.id, userId: outsider.id, role: "MEMBER" } });
    await prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: true } });
    try {
      actAs({ id: outsider.id, name: outsider.name, email: outsider.email, role: outsider.role, orgId: w.orgA.id });
      expect(await status(docsRoot.GET(json("GET", "/x"), pp))).toBe(200);
      expect(await status(docsPage.GET(json("GET", "/x"), pg))).toBe(200);
      // Still read-only for them.
      expect(await status(docsPages.POST(json("POST", "/x", { title: "non-member write" }), pp))).toBe(403);

      actAs(w.users.bMember);
      for (const [label, call] of [
        ["GET docspace", () => docsRoot.GET(json("GET", "/x"), pp)],
        ["GET pages", () => docsPages.GET(json("GET", "/x"), pp)],
        ["GET page", () => docsPage.GET(json("GET", "/x"), pg)],
        ["GET revisions", () => docsRevisions.GET(json("GET", "/x"), pg)],
        ["GET search", () => docsSearch.GET(json("GET", "/x?q=secret"), pp)],
      ] as const) {
        expect([403, 404], label).toContain(await status(call()));
      }
    } finally {
      await prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: false } });
      await prisma.orgMember.deleteMany({ where: { userId: outsider.id } });
      await prisma.user.delete({ where: { id: outsider.id } });
    }
  });
});

// SECH-97: POST /api/docs/[projectKey]/pages/[pageId]/file — the one docs write that takes a
// multipart upload and writes to S3 + the org's storage quota.
describe("docs file upload stays inside the caller's own docspace and role", () => {
  const upload = (projectKey: string, pageId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return docsFile.POST(
      new NextRequest(url(`/api/docs/${projectKey}/pages/${pageId}/file`), { method: "POST", body: form }),
      params({ projectKey, pageId })
    );
  };
  const pdf = () => new File(["%PDF-1.4 itest"], "report.pdf", { type: "application/pdf" });
  const fileState = (id: string) => prisma.docPage.findUniqueOrThrow({ where: { id }, select: { type: true, fileKey: true, fileSize: true, mimeType: true } });

  it("Org B cannot upload onto Org A's page, via A's key or via its own key", async () => {
    const before = await fileState(w.A.page.id);
    actAs(w.users.bOwner);
    expect(await status(upload(w.keyA, w.A.page.id, pdf()))).toBe(404);
    expect(await status(upload(w.keyB, w.A.page.id, pdf()))).toBe(404); // page id from another docspace
    expect(await fileState(w.A.page.id)).toEqual(before);
  });

  it("a VIEWER, and a same-org reader of a public docspace, cannot upload", async () => {
    const before = await fileState(w.A.page.id);
    actAs(w.users.aViewer);
    expect(await status(upload(w.keyA, w.A.page.id, pdf()))).toBe(403);

    const reader = await prisma.user.create({ data: { name: "reader", email: `${w.tag}-reader@itest.local`, passwordHash: "x" } });
    await prisma.orgMember.create({ data: { orgId: w.orgA.id, userId: reader.id, role: "MEMBER" } });
    await prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: true } });
    try {
      actAs({ id: reader.id, name: reader.name, email: reader.email, role: reader.role, orgId: w.orgA.id });
      expect(await status(upload(w.keyA, w.A.page.id, pdf()))).toBe(403);
    } finally {
      await prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: false } });
      await prisma.orgMember.deleteMany({ where: { userId: reader.id } });
      await prisma.user.delete({ where: { id: reader.id } });
    }
    expect(await fileState(w.A.page.id)).toEqual(before);
  });

  it("closed projects, disallowed file types and an exhausted org quota are all refused", async () => {
    const before = await fileState(w.B.page.id);
    actAs(w.users.bMember);

    await prisma.project.update({ where: { id: w.B.project.id }, data: { isClosed: true } });
    try {
      expect(await status(upload(w.keyB, w.B.page.id, pdf()))).toBe(403);
    } finally {
      await prisma.project.update({ where: { id: w.B.project.id }, data: { isClosed: false } });
    }

    expect(await status(upload(w.keyB, w.B.page.id, new File(["<script>"], "x.html", { type: "text/html" })))).toBe(400);
    expect(await status(upload(w.keyB, w.B.page.id, new File(["<script>"], "x.html", { type: "application/pdf" })))).toBe(400);

    // Push Org B past its 5 GB quota (Attachment.fileSize is Int, so three ~2 GB rows).
    const big = await Promise.all([1, 2, 3].map((n) =>
      prisma.attachment.create({ data: { issueId: w.B.issue2.id, uploaderId: w.users.bOwner.id, fileName: `big${n}.pdf`, fileKey: `attachments/${w.B.issue2.id}/big${n}.pdf`, fileSize: 2_000_000_000, mimeType: "application/pdf" } })
    ));
    try {
      expect(await status(upload(w.keyB, w.B.page.id, pdf()))).toBe(507);
    } finally {
      await prisma.attachment.deleteMany({ where: { id: { in: big.map((b) => b.id) } } });
    }
    expect(await fileState(w.B.page.id)).toEqual(before);
  });

  it("control: a TEAM_MEMBER uploads onto their own page; the object key is confined to that page", async () => {
    const page = await prisma.docPage.create({
      data: { docSpaceId: w.B.docSpace.id, sectionId: null, title: "upload target", content: "", authorId: w.users.bOwner.id, position: 77 },
    });
    try {
      actAs(w.users.bMember);
      const res = await upload(w.keyB, page.id, new File(["%PDF-1.4 itest"], "../../evil name.pdf", { type: "application/pdf" }));
      expect(res.status).toBe(200);
      const after = await fileState(page.id);
      expect(after.type).toBe("DOCUMENT");
      expect(after.fileKey).toMatch(new RegExp(`^docs/${w.B.docSpace.id}/${page.id}/[0-9a-f-]{36}-[A-Za-z0-9._-]+$`));
      expect(after.fileKey).not.toContain("/../");
    } finally {
      await prisma.docPage.delete({ where: { id: page.id } });
    }
  });
});
