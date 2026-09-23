import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-106 definition of done: "an inventory test that fails when a new Prisma write to
 * description/body/content appears without going through the sanitizer".
 *
 * Two halves, which together close the loop on stored XSS:
 *
 *   1. Every Prisma write to a rich-text field runs through a sanitiser, or is an
 *      explicitly listed exception with a written reason.
 *   2. Raw HTML is only ever injected at the two known sinks. Unsanitised data can
 *      only hurt if something renders it as markup, so pinning the sinks is what
 *      makes an exception in (1) safe to grant.
 *
 * This is a static scan, so it is approximate by nature. It sees the common shape —
 * a field assigned inline in a Prisma `data:` object. It deliberately does NOT try to
 * follow a value built up elsewhere (`data.content = sanitizeTipTapHtml(...)` before the
 * call); those read as no hit at all rather than a false alarm. The DB-backed
 * stored-xss.itest.ts is what proves the actual behaviour of each path end to end.
 */

const SRC = path.join(__dirname, "..");
const RICH_TEXT_FIELDS = ["description", "body", "content"] as const;

// Test support and fixtures write deliberately unsanitised content.
const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support)/;

/** Helpers that are themselves sanitisers. `normalizeBody` sanitises HTML input and HTML-escapes plain text. */
const SANITISING = /sanitiz|normalizeBody/i;

/**
 * Writes that legitimately store un-sanitised text. Each entry must say why it is safe,
 * and every one of them depends on the sink inventory below staying accurate.
 */
const EXCEPTIONS: Array<{ file: string; model: string; field: string; reason: string }> = [
  {
    file: "app/api/ai/chat/route.ts",
    model: "aiMessage",
    field: "content",
    reason:
      "AI chat transcript. AiChatPanel renders {m.content} as a React child, which React escapes — it is never passed to a raw-HTML sink. Sanitising it would mangle code blocks the model legitimately returns.",
  },
  {
    file: "app/api/docs/[projectKey]/pages/[pageId]/route.ts",
    model: "pageRevision",
    field: "content",
    reason:
      "Snapshot of the page's own content, taken inside the same transaction as the write that already sanitised it. Re-sanitising a stored value would be a no-op.",
  },
  {
    file: "lib/mcp/server.ts",
    model: "pageRevision",
    field: "content",
    reason: "Same revision snapshot as above, on the MCP write_doc_page path.",
  },
  {
    file: "app/api/projects/route.ts",
    model: "project",
    field: "description",
    reason:
      "Project.description is a plain-text textarea, not TipTap, and is rendered as an escaped React child. Running an HTML sanitiser over it would silently delete legitimate angle brackets from prose.",
  },
];

/** Every place the app injects raw HTML. Adding one is a deliberate security decision. */
const ALLOWED_HTML_SINKS = [
  {
    file: "components/ui/rich-text-display.tsx",
    reason: "The rich-text viewer. Trusts the database by design; that trust is what the write-path sanitising buys.",
  },
  {
    file: "components/docs/doc-document-view.tsx",
    reason: "DOCX preview. Content comes from docx-preview.ts, which runs sanitizeDocxPreviewHtml before returning.",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_PATH.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

/** Text between the parentheses of the call whose opening paren is at `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** The expression assigned to `field:` starting just past the colon. */
function valueAt(args: string, start: number): string {
  let depth = 0;
  let out = "";
  for (let i = start; i < args.length; i++) {
    const c = args[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
    out += c;
  }
  return out.trim();
}

interface Write {
  file: string;
  line: number;
  model: string;
  method: string;
  field: string;
  value: string;
}

function findRichTextWrites(): Write[] {
  const writes: Write[] = [];
  const CALL = /\b(?:prisma|tx)\s*\.\s*(\w+)\s*\.\s*(create|update|upsert|createMany|updateMany)\s*\(/g;

  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    CALL.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = CALL.exec(src))) {
      const args = argsAt(src, call.index + call[0].length - 1);
      for (const field of RICH_TEXT_FIELDS) {
        const FIELD = new RegExp(`(?:^|[\\s{,])${field}\\s*:\\s*`, "g");
        let hit: RegExpExecArray | null;
        while ((hit = FIELD.exec(args))) {
          writes.push({
            file: rel(file),
            line: src.slice(0, call.index).split("\n").length,
            model: call[1],
            method: call[2],
            field,
            value: valueAt(args, hit.index + hit[0].length),
          });
        }
      }
    }
  }
  return writes;
}

describe("every Prisma write to a rich-text field is sanitised", () => {
  const writes = findRichTextWrites();

  it("found the known write paths", () => {
    // Guards the scanner itself: a regex that silently stops matching would make
    // every assertion below pass vacuously.
    expect(writes.length).toBeGreaterThanOrEqual(15);
    expect(writes.some((w) => w.file.endsWith("v1/issues/route.ts"))).toBe(true);
    expect(writes.some((w) => w.model === "comment")).toBe(true);
    expect(writes.some((w) => w.model === "docPage")).toBe(true);
  });

  for (const w of writes) {
    const excepted = EXCEPTIONS.find((e) => e.file === w.file && e.model === w.model && e.field === w.field);
    const label = `${w.file}:${w.line} ${w.model}.${w.method} ${w.field}`;

    it(`${label}`, () => {
      if (excepted) {
        expect(excepted.reason.length, `exception for ${label} needs a real reason`).toBeGreaterThan(40);
        return;
      }
      expect(
        SANITISING.test(w.value),
        `${label} assigns \`${w.value}\`, which does not go through a sanitiser.\n` +
          `Wrap it in sanitizeTipTapHtml() (or normalizeBody() on the external/MCP paths).\n` +
          `If it is genuinely safe, add it to EXCEPTIONS in this file with the reason why.`,
      ).toBe(true);
    });
  }

  it("lists no exception that no longer matches a real write", () => {
    for (const e of EXCEPTIONS) {
      const still = writes.some((w) => w.file === e.file && w.model === e.model && w.field === e.field);
      expect(still, `stale exception: ${e.file} ${e.model}.${e.field} — remove it`).toBe(true);
    }
  });
});

describe("raw HTML is only injected at known sinks", () => {
  const sinks: Array<{ file: string; line: number }> = [];
  for (const file of walk(SRC)) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // Skip prose mentions in comments; only attribute usage counts.
        if (/dangerouslySetInnerHTML\s*=/.test(line)) sinks.push({ file: rel(file), line: i + 1 });
      });
  }

  it("found the known sinks", () => {
    expect(sinks.length).toBeGreaterThan(0);
  });

  for (const s of sinks) {
    it(`${s.file}:${s.line} is an approved sink`, () => {
      const allowed = ALLOWED_HTML_SINKS.find((a) => s.file === a.file);
      expect(
        allowed,
        `${s.file}:${s.line} injects raw HTML. Every value reaching a sink must already be sanitised ` +
          `on the write path. If this is correct, add it to ALLOWED_HTML_SINKS with the reason.`,
      ).toBeDefined();
    });
  }

  it("lists no approved sink that no longer exists", () => {
    for (const a of ALLOWED_HTML_SINKS) {
      expect(sinks.some((s) => s.file === a.file), `stale sink entry: ${a.file}`).toBe(true);
    }
  });
});
