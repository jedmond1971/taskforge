import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGetCurrentUser } = vi.hoisted(() => ({
  mockPrisma: {
    project: { findMany: vi.fn() },
    issue: { findMany: vi.fn() },
    docPage: { findMany: vi.fn() },
    comment: { findMany: vi.fn() },
  },
  mockGetCurrentUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mockGetCurrentUser }));

import { paletteSearch } from "@/app/(dashboard)/command-palette-actions";
import {
  availableCommands,
  buildSnippet,
  htmlToText,
  isContentSearchable,
  detectIssueKey,
  filterCommands,
  isSafeRecent,
  isSearchable,
  normalizeQuery,
  projectKeyFromPath,
  pushRecent,
} from "@/lib/command-palette";

describe("command palette helpers", () => {
  it("normalizes and caps the query", () => {
    expect(normalizeQuery("  hello  ")).toBe("hello");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery({ a: 1 })).toBe("");
  });

  it("requires two characters", () => {
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
  });

  it("detects and upper-cases issue keys", () => {
    expect(detectIssueKey("jfr-176")).toBe("JFR-176");
    expect(detectIssueKey(" JFR-1 ")).toBe("JFR-1");
    expect(detectIssueKey("A1-22")).toBe("A1-22");
    for (const bad of ["jfr", "176", "jfr-", "jfr-1a", "1-2", "jfr 176", "jfr-1 bug"]) {
      expect(detectIssueKey(bad), bad).toBeNull();
    }
  });

  it("filters commands by every term across label and keywords", () => {
    const cmds = availableCommands({ isAdmin: true, projectKey: "ABC" });
    expect(filterCommands(cmds, "")).toEqual(cmds);
    expect(filterCommands(cmds, "dark").map((c) => c.id)).toEqual(["theme-dark"]);
    expect(filterCommands(cmds, "go proj").map((c) => c.id)).toEqual(["go-projects", "go-closed"]);
    expect(filterCommands(cmds, "zzzz")).toEqual([]);
  });

  it("hides Admin from non-admins and Create issue outside a project", () => {
    const ids = (ctx: { isAdmin: boolean; projectKey: string | null }) => availableCommands(ctx).map((c) => c.id);
    expect(ids({ isAdmin: false, projectKey: null })).not.toContain("go-admin");
    expect(ids({ isAdmin: false, projectKey: null })).not.toContain("create-issue");
    expect(ids({ isAdmin: true, projectKey: "ABC" })).toEqual(expect.arrayContaining(["go-admin", "create-issue"]));
  });

  it("extracts the project key from a path", () => {
    expect(projectKeyFromPath("/projects/abc/issues/ABC-1")).toBe("ABC");
    expect(projectKeyFromPath("/projects/ABC")).toBe("ABC");
    expect(projectKeyFromPath("/projects")).toBeNull();
    expect(projectKeyFromPath("/projects/closed")).toBeNull();
    expect(projectKeyFromPath("/search")).toBeNull();
  });

  it("only accepts same-origin recents, dedupes and caps at 5", () => {
    const ok = { kind: "issue", title: "t", subtitle: "s", href: "/projects/A/issues/A-1" };
    expect(isSafeRecent(ok)).toBe(true);
    expect(isSafeRecent({ ...ok, href: "https://evil.example" })).toBe(false);
    expect(isSafeRecent({ ...ok, href: "//evil.example" })).toBe(false);
    expect(isSafeRecent({ ...ok, kind: "other" })).toBe(false);
    let list: ReturnType<typeof pushRecent> = [];
    for (let i = 0; i < 7; i++) list = pushRecent(list, { ...ok, href: `/p/${i}` } as never);
    list = pushRecent(list, { ...ok, href: "/p/3" } as never);
    expect(list).toHaveLength(5);
    expect(list[0].href).toBe("/p/3");
  });
});

describe("paletteSearch", () => {
  const issueRow = (key: string) => ({
    key,
    title: `title ${key}`,
    priority: "HIGH",
    project: { key: "ABC" },
    projectStatus: { name: "Todo", category: "TODO" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: "u1", role: "MEMBER" });
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.issue.findMany.mockResolvedValue([]);
    mockPrisma.docPage.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
  });

  it("returns unauthorized without a (valid) session and never queries", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    expect(await paletteSearch("anything")).toEqual({ ok: false, error: "unauthorized" });
    expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.issue.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.docPage.findMany).not.toHaveBeenCalled();
  });

  it.each(["", " ", "a", "  a  ", undefined as unknown as string])("short/blank query %j is empty without hitting prisma", async (q) => {
    expect(await paletteSearch(q)).toEqual({ ok: true, projects: [], issues: [], docs: [], content: [] });
    expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.issue.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.docPage.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.comment.findMany).not.toHaveBeenCalled();
  });

  it("scopes every query to the caller's open, member projects", async () => {
    await paletteSearch("ABC-12");
    const scope = { members: { some: { userId: "u1" } }, isClosed: false };
    const projectArgs = mockPrisma.project.findMany.mock.calls[0][0];
    expect(projectArgs.where).toMatchObject(scope);
    const issueCalls = mockPrisma.issue.findMany.mock.calls.map((c) => c[0]);
    expect(issueCalls).toHaveLength(3); // title match + exact key + description match
    for (const args of issueCalls) expect(args.where.project).toEqual(scope);
    expect(issueCalls.some((a) => a.where.key === "ABC-12")).toBe(true);
    // JFR-194: every content query carries the same member + not-closed scope.
    const docCalls = mockPrisma.docPage.findMany.mock.calls.map((c) => c[0]);
    expect(docCalls).toHaveLength(2); // title + content
    for (const args of docCalls) expect(args.where.docSpace).toEqual({ project: scope });
    const commentCalls = mockPrisma.comment.findMany.mock.calls.map((c) => c[0]);
    expect(commentCalls).toHaveLength(1);
    expect(commentCalls[0].where.issue).toEqual({ project: scope });
  });

  it("only runs the exact-key lookup for key-shaped queries", async () => {
    await paletteSearch("some title");
    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(2); // title + description, no exact key
  });

  it("puts the exact key first, dedupes, and caps results", async () => {
    mockPrisma.issue.findMany.mockImplementation(async (args: { where: { key?: string } }) =>
      args.where.key
        ? [issueRow("ABC-3")]
        : [issueRow("ABC-1"), issueRow("ABC-3"), ...Array.from({ length: 10 }, (_, i) => issueRow(`ABC-${10 + i}`))]
    );
    const res = await paletteSearch("abc-3");
    if (!res.ok) throw new Error("expected ok");
    expect(res.issues[0].key).toBe("ABC-3");
    expect(res.issues.filter((i) => i.key === "ABC-3")).toHaveLength(1);
    expect(res.issues.length).toBeLessThanOrEqual(8);
    expect(mockPrisma.project.findMany.mock.calls[0][0].take).toBe(5);
    expect(mockPrisma.docPage.findMany.mock.calls[0][0].take).toBe(5);
  });

  it("maps docs to a serializable shape and selects no bodies", async () => {
    mockPrisma.docPage.findMany.mockResolvedValue([
      { id: "p1", title: "Guide", section: null, docSpace: { project: { key: "ABC" } } },
    ]);
    const res = await paletteSearch("guide");
    expect(res).toMatchObject({ ok: true, docs: [{ id: "p1", title: "Guide", projectKey: "ABC", sectionTitle: null }] });
    // Only the content queries (never the title queries) read bodies.
    const select = mockPrisma.docPage.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("content");
    expect(mockPrisma.issue.findMany.mock.calls[0][0].select).not.toHaveProperty("description");
  });

  it("returns a generic failure instead of throwing details", async () => {
    mockPrisma.project.findMany.mockRejectedValue(new Error("connection refused: secret-host"));
    expect(await paletteSearch("abc")).toEqual({ ok: false, error: "failed" });
  });
});

describe("htmlToText / buildSnippet (JFR-194)", () => {
  it("strips tags without fusing blocks and decodes entities after stripping", () => {
    expect(htmlToText("<p>one</p><p>two &amp; <strong>three</strong></p><ul><li>four</li></ul>")).toBe("one two & three four");
    // Escaped markup stays literal text; it is never re-interpreted.
    expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<script>alert(1)</script>");
    expect(htmlToText("<p>caf&#233; &#x1F600; &bogus; &#99999999;</p>")).toBe("café 😀 &bogus; &#99999999;");
  });

  it("returns null when only tag or attribute text matched", () => {
    expect(buildSnippet('<p><a href="https://x.example">click</a></p>', "href")).toBeNull();
    expect(buildSnippet("<p class=\"note\">hello</p>", "class")).toBeNull();
    expect(buildSnippet(null, "abc")).toBeNull();
    expect(buildSnippet("<p>abc</p>", "")).toBeNull();
  });

  it("matches case-insensitively, keeps the original casing and treats the query literally", () => {
    expect(buildSnippet("<p>Roll back the DEPLOY now</p>", "deploy")).toEqual({
      before: "Roll back the ",
      match: "DEPLOY",
      after: " now",
    });
    expect(buildSnippet("<p>cost is $5 (approx) [x]</p>", "(approx)")?.match).toBe("(approx)");
    expect(buildSnippet("<p>anything at all</p>", ".*")).toBeNull();
  });

  it("windows long text with ellipses at cut ends only", () => {
    const text = `${"a ".repeat(100)}NEEDLE${" b".repeat(100)}`;
    const snip = buildSnippet(`<p>${text}</p>`, "needle")!;
    expect(snip.before.startsWith("…")).toBe(true);
    expect(snip.after.endsWith("…")).toBe(true);
    expect(snip.before.length + snip.match.length + snip.after.length).toBeLessThan(140);
    const short = buildSnippet("<p>needle here</p>", "needle")!;
    expect(short.before).toBe("");
    expect(short.after).toBe(" here");
  });

  it("does not find a match beyond the scan limit", () => {
    expect(buildSnippet(`<p>${"x".repeat(60_000)}needle</p>`, "needle")).toBeNull();
  });

  it("only searches content from three characters", () => {
    expect(isContentSearchable("ab")).toBe(false);
    expect(isContentSearchable("abc")).toBe(true);
  });
});

describe("paletteSearch content hits (JFR-194)", () => {
  const issueRow = (key: string, description: string | null) => ({
    key,
    title: `title ${key}`,
    description,
    priority: "HIGH",
    project: { key: "ABC" },
    projectStatus: { name: "Todo", category: "TODO" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ id: "u1", role: "MEMBER" });
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.issue.findMany.mockResolvedValue([]);
    mockPrisma.docPage.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
  });

  it("skips content queries for two-character queries but still runs title search", async () => {
    await paletteSearch("ab");
    expect(mockPrisma.comment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.docPage.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(1);
  });

  it("builds snippets, drops tag-only matches, dedupes comments per issue and caps each source", async () => {
    mockPrisma.issue.findMany.mockImplementation(async (args: { where: { description?: unknown } }) =>
      args.where.description
        ? [
            issueRow("ABC-1", '<p>see <a href="https://x.example/needle">link</a></p>'), // attribute only
            ...Array.from({ length: 8 }, (_, i) => issueRow(`ABC-${10 + i}`, `<p>the needle ${i}</p>`)),
          ]
        : []
    );
    mockPrisma.comment.findMany.mockResolvedValue(
      ["c1", "c2", "c3"].map((id, i) => ({
        body: `<p>needle ${id}</p>`,
        issue: { key: i < 2 ? "ABC-50" : "ABC-51", title: "t", project: { key: "ABC" } },
      }))
    );
    mockPrisma.docPage.findMany.mockImplementation(async (args: { where: { content?: unknown } }) =>
      args.where.content
        ? [{ id: "d1", title: "Doc", content: "<h2>Heading</h2><p>a needle in a doc</p>", docSpace: { project: { key: "ABC" } } }]
        : []
    );
    const res = await paletteSearch("needle");
    if (!res.ok) throw new Error("expected ok");
    expect(res.content.filter((c) => c.kind === "issue")).toHaveLength(4);
    expect(res.content.some((c) => c.ref === "ABC-1")).toBe(false);
    expect(res.content.filter((c) => c.kind === "comment").map((c) => c.ref)).toEqual(["ABC-50", "ABC-51"]);
    expect(res.content.find((c) => c.kind === "doc")).toMatchObject({
      ref: "d1",
      snippet: { before: "Heading a ", match: "needle", after: " in a doc" },
    });
  });

  it("does not repeat a row whose title already matched", async () => {
    mockPrisma.issue.findMany.mockImplementation(async (args: { where: { title?: unknown; description?: unknown } }) =>
      args.where.title || args.where.description ? [issueRow("ABC-1", "<p>needle</p>")] : []
    );
    mockPrisma.docPage.findMany.mockImplementation(async () => [
      { id: "d1", title: "needle", section: null, content: "<p>needle</p>", docSpace: { project: { key: "ABC" } } },
    ]);
    const res = await paletteSearch("needle");
    if (!res.ok) throw new Error("expected ok");
    expect(res.issues.map((i) => i.key)).toEqual(["ABC-1"]);
    expect(res.docs.map((d) => d.id)).toEqual(["d1"]);
    expect(res.content).toEqual([]);
  });

  it("returns snippets as inert text parts, never markup", async () => {
    mockPrisma.comment.findMany.mockResolvedValue([
      { body: "<p>&lt;img src=x onerror=alert(1)&gt; needle <script>alert(2)</script></p>", issue: { key: "ABC-9", title: "t", project: { key: "ABC" } } },
    ]);
    const res = await paletteSearch("needle");
    if (!res.ok) throw new Error("expected ok");
    const text = JSON.stringify(res.content[0].snippet);
    expect(text).not.toMatch(/<script|<\/script/i);
    expect(res.content[0].snippet.before).toContain("<img src=x onerror=alert(1)>"); // literal text, escaped by React on render
  });
});
