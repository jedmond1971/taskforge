import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn, mockDeleteObject } = vi.hoisted(() => {
  const mockPrisma = {
    project: { findFirst: vi.fn() },
    projectMember: { findFirst: vi.fn(), findUnique: vi.fn() },
    docSpace: { findUnique: vi.fn(), upsert: vi.fn() },
    docPage: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    docSection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    pageRevision: { findMany: vi.fn(), create: vi.fn() },
    issueDocLink: { findMany: vi.fn() },
  };
  const mockAuthFn = vi.fn();
  const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
  return { mockPrisma, mockAuthFn, mockDeleteObject };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("@/lib/s3", () => ({
  deleteObject: mockDeleteObject,
  putObject: vi.fn(),
  getPresignedDownloadUrl: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { GET as getDocSpace, PATCH as patchDocSpace } from "@/app/api/docs/[projectKey]/route";
import { GET as getPages, POST as postPages } from "@/app/api/docs/[projectKey]/pages/route";
import {
  GET as getPage,
  PATCH as patchPage,
  DELETE as deletePage,
} from "@/app/api/docs/[projectKey]/pages/[pageId]/route";
import {
  GET as getSections,
  POST as postSections,
} from "@/app/api/docs/[projectKey]/sections/route";
import {
  PATCH as patchSection,
  DELETE as deleteSection,
} from "@/app/api/docs/[projectKey]/sections/[sectionId]/route";
import { GET as searchPages } from "@/app/api/docs/[projectKey]/search/route";
import { GET as getRevisions } from "@/app/api/docs/[projectKey]/pages/[pageId]/revisions/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ProjectRole = "PROJECT_LEAD" | "TEAM_MEMBER" | "VIEWER";

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function makeGetRequest(url = "http://localhost/test"): NextRequest {
  const urlObj = new URL(url);
  return {
    url,
    nextUrl: { searchParams: urlObj.searchParams },
  } as unknown as NextRequest;
}

function mockSession(userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId } });
}

function mockNoSession() {
  mockAuthFn.mockResolvedValue(null);
}

/** Set up the three prisma calls that resolveDocCtx makes for a project member */
function setupMemberCtx(role: ProjectRole = "PROJECT_LEAD") {
  mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role });
  mockPrisma.docSpace.upsert.mockResolvedValue({ id: "ds-1", isPublic: false });
}

/** Set up resolveDocCtx for a non-member accessing a public docspace */
function setupPublicNonMember() {
  mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
  mockPrisma.projectMember.findUnique.mockResolvedValue(null);
  mockPrisma.docSpace.findUnique.mockResolvedValue({ id: "ds-1", isPublic: true });
}

// ─── resolveDocCtx ─────────────────────────────────────────────────────────────

describe("resolveDocCtx", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an unknown project", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    expect(await resolveDocCtx("UNKNOWN", "user-1")).toBeNull();
  });

  it("returns a DocCtx with role for a project member", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "TEAM_MEMBER" });
    mockPrisma.docSpace.upsert.mockResolvedValue({ id: "ds-1", isPublic: false });

    const ctx = await resolveDocCtx("PRJ", "user-1");
    expect(ctx).toEqual({ projectId: "proj-1", docSpaceId: "ds-1", isPublic: false, role: "TEAM_MEMBER" });
  });

  it("upserts the docspace (lazy-create) for a member", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" });
    mockPrisma.docSpace.upsert.mockResolvedValue({ id: "ds-new", isPublic: false });

    await resolveDocCtx("PRJ", "user-1");

    expect(mockPrisma.docSpace.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "proj-1" }, create: { projectId: "proj-1" } })
    );
  });

  it("returns null for a non-member accessing a private docspace", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);
    mockPrisma.docSpace.findUnique.mockResolvedValue({ id: "ds-1", isPublic: false });

    expect(await resolveDocCtx("PRJ", "outsider")).toBeNull();
  });

  it("returns role=null for a non-member on a public docspace", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);
    mockPrisma.docSpace.findUnique.mockResolvedValue({ id: "ds-1", isPublic: true });

    const ctx = await resolveDocCtx("PRJ", "outsider");
    expect(ctx).toEqual({ projectId: "proj-1", docSpaceId: "ds-1", isPublic: true, role: null });
  });
});

// ─── GET /api/docs/[projectKey] ───────────────────────────────────────────────

describe("GET /api/docs/[projectKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await getDocSpace(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when project not found / access denied", async () => {
    mockSession();
    mockPrisma.project.findFirst.mockResolvedValue(null);
    const res = await getDocSpace(makeGetRequest(), { params: { projectKey: "UNKNOWN" } });
    expect(res.status).toBe(404);
  });

  it("returns 200 with docspace for a project member", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docSpace.findUnique.mockResolvedValue({
      id: "ds-1",
      isPublic: false,
      sections: [],
      pages: [],
    });

    const res = await getDocSpace(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docSpace).toBeDefined();
  });
});

// ─── PATCH /api/docs/[projectKey] — visibility toggle ─────────────────────────

describe("PATCH /api/docs/[projectKey]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await patchDocSpace(makeRequest({ isPublic: true }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not a project member", async () => {
    mockSession();
    mockPrisma.projectMember.findFirst.mockResolvedValue(null);
    const res = await patchDocSpace(makeRequest({ isPublic: true }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 for TEAM_MEMBER (PROJECT_LEAD only)", async () => {
    mockSession();
    mockPrisma.projectMember.findFirst.mockResolvedValue({
      role: "TEAM_MEMBER",
      project: { id: "proj-1" },
    });
    const res = await patchDocSpace(makeRequest({ isPublic: true }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(403);
  });

  it("returns 400 when isPublic is not a boolean", async () => {
    mockSession();
    mockPrisma.projectMember.findFirst.mockResolvedValue({
      role: "PROJECT_LEAD",
      project: { id: "proj-1" },
    });
    const res = await patchDocSpace(makeRequest({ isPublic: "yes" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(400);
  });

  it("returns 200 and updates visibility for PROJECT_LEAD", async () => {
    mockSession();
    mockPrisma.projectMember.findFirst.mockResolvedValue({
      role: "PROJECT_LEAD",
      project: { id: "proj-1" },
    });
    mockPrisma.docSpace.upsert.mockResolvedValue({ id: "ds-1", isPublic: true });

    const res = await patchDocSpace(makeRequest({ isPublic: true }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docSpace.isPublic).toBe(true);
  });
});

// ─── GET /api/docs/[projectKey]/pages ────────────────────────────────────────

describe("GET /api/docs/[projectKey]/pages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await getPages(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(401);
  });

  it("returns 200 with pages for any member (including VIEWER)", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docPage.findMany.mockResolvedValue([{ id: "p-1", title: "Home" }]);

    const res = await getPages(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages).toHaveLength(1);
  });
});

// ─── POST /api/docs/[projectKey]/pages ───────────────────────────────────────

describe("POST /api/docs/[projectKey]/pages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for VIEWER", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    const res = await postPages(makeRequest({ title: "New Page" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(403);
  });

  it("returns 403 for authenticated non-member on a public docspace", async () => {
    mockSession();
    setupPublicNonMember();
    const res = await postPages(makeRequest({ title: "New Page" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(403);
  });

  it("returns 400 when title is empty", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    const res = await postPages(makeRequest({ title: "  " }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(400);
  });

  it("returns 201 with new page for TEAM_MEMBER", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docPage.aggregate.mockResolvedValue({ _max: { position: null } });
    mockPrisma.docPage.create.mockResolvedValue({
      id: "p-1",
      title: "My Page",
      type: "NATIVE",
      author: { id: "user-1", name: "Alice", avatarUrl: null },
    });

    const res = await postPages(makeRequest({ title: "My Page" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.page.title).toBe("My Page");
  });
});

// ─── GET /api/docs/[projectKey]/pages/[pageId] ───────────────────────────────

describe("GET /api/docs/[projectKey]/pages/[pageId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await getPage(makeGetRequest(), { params: { projectKey: "PRJ", pageId: "p-1" } });
    expect(res.status).toBe(401);
  });

  it("returns 200 with page for any member", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1",
      title: "About",
      type: "NATIVE",
      content: "<p>Hello</p>",
      author: { id: "user-1", name: "Alice", avatarUrl: null },
      section: null,
    });

    const res = await getPage(makeGetRequest(), { params: { projectKey: "PRJ", pageId: "p-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page.id).toBe("p-1");
  });
});

// ─── PATCH /api/docs/[projectKey]/pages/[pageId] ─────────────────────────────

describe("PATCH /api/docs/[projectKey]/pages/[pageId]", () => {
  const PAGE_PARAMS = { params: { projectKey: "PRJ", pageId: "p-1" } };

  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for VIEWER", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", content: "<p>Old</p>", fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });

    const res = await patchPage(makeRequest({ title: "Updated" }), PAGE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("creates a PageRevision snapshot when content is updated and page has existing content", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", content: "<p>Old content</p>", fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });
    mockPrisma.pageRevision.create.mockResolvedValue({ id: "rev-1" });
    mockPrisma.docPage.update.mockResolvedValue({
      id: "p-1", title: "Title", content: "<p>New</p>",
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });

    await patchPage(makeRequest({ content: "<p>New</p>" }), PAGE_PARAMS);

    expect(mockPrisma.pageRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pageId: "p-1", content: "<p>Old content</p>" }),
      })
    );
  });

  it("does NOT create a revision when content is not in the request body", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", content: "<p>Old</p>", fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });
    mockPrisma.docPage.update.mockResolvedValue({
      id: "p-1", title: "New Title", content: "<p>Old</p>",
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });

    await patchPage(makeRequest({ title: "New Title" }), PAGE_PARAMS);

    expect(mockPrisma.pageRevision.create).not.toHaveBeenCalled();
  });

  it("returns 200 for TEAM_MEMBER with valid fields", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", content: null, fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });
    mockPrisma.docPage.update.mockResolvedValue({
      id: "p-1", title: "New Title", content: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });

    const res = await patchPage(makeRequest({ title: "New Title" }), PAGE_PARAMS);
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /api/docs/[projectKey]/pages/[pageId] ────────────────────────────

describe("DELETE /api/docs/[projectKey]/pages/[pageId]", () => {
  const PAGE_PARAMS = { params: { projectKey: "PRJ", pageId: "p-1" } };

  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for TEAM_MEMBER (PROJECT_LEAD only)", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });

    const res = await deletePage(makeGetRequest(), PAGE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("deletes S3 object when page has a fileKey", async () => {
    mockSession();
    setupMemberCtx("PROJECT_LEAD");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", fileKey: "docs/ds-1/p-1/file.pdf",
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });
    mockPrisma.docPage.delete.mockResolvedValue({ id: "p-1" });

    await deletePage(makeGetRequest(), PAGE_PARAMS);

    expect(mockDeleteObject).toHaveBeenCalledWith("docs/ds-1/p-1/file.pdf");
  });

  it("returns 200 for PROJECT_LEAD", async () => {
    mockSession();
    setupMemberCtx("PROJECT_LEAD");
    mockPrisma.docPage.findFirst.mockResolvedValue({
      id: "p-1", fileKey: null,
      author: { id: "user-1", name: "Alice", avatarUrl: null }, section: null,
    });
    mockPrisma.docPage.delete.mockResolvedValue({ id: "p-1" });

    const res = await deletePage(makeGetRequest(), PAGE_PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});

// ─── GET /api/docs/[projectKey]/sections ─────────────────────────────────────

describe("GET /api/docs/[projectKey]/sections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await getSections(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(401);
  });

  it("returns 200 with sections for any member", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docSection.findMany.mockResolvedValue([{ id: "s-1", title: "Getting Started", pages: [] }]);

    const res = await getSections(makeGetRequest(), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections).toHaveLength(1);
  });
});

// ─── POST /api/docs/[projectKey]/sections ────────────────────────────────────

describe("POST /api/docs/[projectKey]/sections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for VIEWER", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    const res = await postSections(makeRequest({ title: "New Section" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(403);
  });

  it("returns 400 when title is empty", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    const res = await postSections(makeRequest({ title: "" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(400);
  });

  it("returns 201 with new section for TEAM_MEMBER", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docSection.aggregate.mockResolvedValue({ _max: { position: null } });
    mockPrisma.docSection.create.mockResolvedValue({ id: "s-1", title: "New Section", position: 0 });

    const res = await postSections(makeRequest({ title: "New Section" }), { params: { projectKey: "PRJ" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.section.title).toBe("New Section");
  });
});

// ─── PATCH /api/docs/[projectKey]/sections/[sectionId] ───────────────────────

describe("PATCH /api/docs/[projectKey]/sections/[sectionId]", () => {
  const SECTION_PARAMS = { params: { projectKey: "PRJ", sectionId: "s-1" } };

  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for VIEWER", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docSection.findFirst.mockResolvedValue({ id: "s-1", title: "Old" });

    const res = await patchSection(makeRequest({ title: "Renamed" }), SECTION_PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 200 for TEAM_MEMBER", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docSection.findFirst.mockResolvedValue({ id: "s-1", title: "Old" });
    mockPrisma.docSection.update.mockResolvedValue({ id: "s-1", title: "Renamed" });

    const res = await patchSection(makeRequest({ title: "Renamed" }), SECTION_PARAMS);
    expect(res.status).toBe(200);
  });

  it("returns 400 when no updatable fields are provided", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docSection.findFirst.mockResolvedValue({ id: "s-1", title: "Old" });

    const res = await patchSection(makeRequest({}), SECTION_PARAMS);
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/docs/[projectKey]/sections/[sectionId] ──────────────────────

describe("DELETE /api/docs/[projectKey]/sections/[sectionId]", () => {
  const SECTION_PARAMS = { params: { projectKey: "PRJ", sectionId: "s-1" } };

  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for TEAM_MEMBER (PROJECT_LEAD only)", async () => {
    mockSession();
    setupMemberCtx("TEAM_MEMBER");
    mockPrisma.docSection.findFirst.mockResolvedValue({ id: "s-1", title: "Section" });

    const res = await deleteSection(makeGetRequest(), SECTION_PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 200 for PROJECT_LEAD", async () => {
    mockSession();
    setupMemberCtx("PROJECT_LEAD");
    mockPrisma.docSection.findFirst.mockResolvedValue({ id: "s-1", title: "Section" });
    mockPrisma.docSection.delete.mockResolvedValue({ id: "s-1" });

    const res = await deleteSection(makeGetRequest(), SECTION_PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});

// ─── GET /api/docs/[projectKey]/search ───────────────────────────────────────

describe("GET /api/docs/[projectKey]/search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await searchPages(
      makeGetRequest("http://localhost/search?q=hello"),
      { params: { projectKey: "PRJ" } }
    );
    expect(res.status).toBe(401);
  });

  it("returns empty array without querying db when q is empty", async () => {
    mockSession();
    setupMemberCtx("VIEWER");

    const res = await searchPages(
      makeGetRequest("http://localhost/search?q="),
      { params: { projectKey: "PRJ" } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(mockPrisma.docPage.findMany).not.toHaveBeenCalled();
  });

  it("returns results with snippet that has HTML tags stripped", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docPage.findMany.mockResolvedValue([
      {
        id: "p-1",
        title: "Architecture",
        type: "NATIVE",
        content: "<h1>Overview</h1><p>The <strong>database</strong> layer handles persistence.</p>",
        section: { id: "s-1", title: "Design" },
        updatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    ]);

    const res = await searchPages(
      makeGetRequest("http://localhost/search?q=database"),
      { params: { projectKey: "PRJ" } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);

    const snippet: string = body.results[0].snippet;
    expect(snippet).not.toContain("<");
    expect(snippet).not.toContain(">");
    expect(snippet.toLowerCase()).toContain("database");
  });

  it("returns null snippet for DOCUMENT pages (no content to excerpt)", async () => {
    mockSession();
    setupMemberCtx("VIEWER");
    mockPrisma.docPage.findMany.mockResolvedValue([
      {
        id: "p-2",
        title: "Database ERD",
        type: "DOCUMENT",
        content: null,
        section: null,
        updatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    ]);

    const res = await searchPages(
      makeGetRequest("http://localhost/search?q=database"),
      { params: { projectKey: "PRJ" } }
    );
    const body = await res.json();
    expect(body.results[0].snippet).toBeNull();
  });
});

// ─── GET /api/docs/[projectKey]/pages/[pageId]/revisions ─────────────────────

describe("GET /api/docs/[projectKey]/pages/[pageId]/revisions", () => {
  const REV_PARAMS = { params: { projectKey: "PRJ", pageId: "p-1" } };

  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockNoSession();
    const res = await getRevisions(makeGetRequest(), REV_PARAMS);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the page does not exist in this project", async () => {
    mockSession();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.docSpace.findUnique.mockResolvedValue({ id: "ds-1" });
    mockPrisma.docPage.findFirst.mockResolvedValue(null);

    const res = await getRevisions(makeGetRequest(), REV_PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 200 with revisions ordered by createdAt desc", async () => {
    mockSession();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "proj-1" });
    mockPrisma.docSpace.findUnique.mockResolvedValue({ id: "ds-1" });
    mockPrisma.docPage.findFirst.mockResolvedValue({ id: "p-1" });
    mockPrisma.pageRevision.findMany.mockResolvedValue([
      { id: "rev-2", content: "<p>v2</p>", createdAt: new Date("2026-05-02"), author: { id: "u1", name: "Alice", avatarUrl: null } },
      { id: "rev-1", content: "<p>v1</p>", createdAt: new Date("2026-05-01"), author: { id: "u1", name: "Alice", avatarUrl: null } },
    ]);

    const res = await getRevisions(makeGetRequest(), REV_PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revisions).toHaveLength(2);
    expect(body.revisions[0].id).toBe("rev-2");
  });
});
