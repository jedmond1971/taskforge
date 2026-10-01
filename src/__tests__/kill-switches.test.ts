import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KILL_SWITCHES, blockedBySwitch, isSwitchEnabled, killSwitchFor } from "@/lib/kill-switches";

/** SECH-118. Pure routing/flag logic, plus an inventory of the route tree so a new surface can't skip a switch. */

describe("isSwitchEnabled", () => {
  it("defaults to enabled when unset, so production behaviour is unchanged", () => {
    for (const name of KILL_SWITCHES) expect(isSwitchEnabled(name, {})).toBe(true);
  });

  it("treats every common spelling of off as off, and anything else as on", () => {
    for (const v of ["false", "FALSE", " false ", "0", "off", "Off", "no", "disabled"]) {
      expect(isSwitchEnabled("UPLOADS_ENABLED", { UPLOADS_ENABLED: v })).toBe(false);
    }
    for (const v of ["true", "1", "on", "", "yes"]) {
      expect(isSwitchEnabled("UPLOADS_ENABLED", { UPLOADS_ENABLED: v })).toBe(true);
    }
  });

  it("switches are independent", () => {
    const env = { OAUTH_MCP_ENABLED: "false" };
    expect(blockedBySwitch("/api/mcp", "POST", env)).toBe("OAUTH_MCP_ENABLED");
    expect(blockedBySwitch("/api/external/v1/projects", "GET", env)).toBeNull();
    expect(blockedBySwitch("/api/attachments/presign", "POST", env)).toBeNull();
  });
});

describe("OAUTH_MCP_ENABLED blocks the whole OAuth/MCP surface", () => {
  const off = { OAUTH_MCP_ENABLED: "false" };
  it.each([
    ["POST", "/api/oauth/token"],
    ["POST", "/api/oauth/register"],
    ["POST", "/api/mcp"],
    ["GET", "/api/mcp"],
    ["DELETE", "/api/mcp"],
    ["GET", "/.well-known/oauth-protected-resource"],
    ["GET", "/.well-known/oauth-authorization-server"],
    ["GET", "/oauth/authorize"],
    ["POST", "/oauth/authorize"], // the consent screen's server action posts to the page URL
  ])("%s %s", (method, p) => {
    expect(blockedBySwitch(p, method, off)).toBe("OAUTH_MCP_ENABLED");
  });

  it("does not catch lookalikes", () => {
    expect(killSwitchFor("/api/mcpx", "GET")).toBeNull();
    expect(killSwitchFor("/api/oauthish", "GET")).toBeNull();
  });
});

describe("EXTERNAL_API_ENABLED blocks the external org API", () => {
  it.each([
    ["GET", "/api/external/v1/projects"],
    ["POST", "/api/external/v1/projects/ABC/issues"],
    ["PATCH", "/api/external/v1/projects/ABC/issues/ABC-1"],
    ["POST", "/api/external/v1/projects/ABC/issues/ABC-1/comments"],
  ])("%s %s", (method, p) => {
    expect(blockedBySwitch(p, method, { EXTERNAL_API_ENABLED: "false" })).toBe("EXTERNAL_API_ENABLED");
  });
});

describe("UPLOADS_ENABLED blocks writes to object storage only", () => {
  const off = { UPLOADS_ENABLED: "false" };
  it.each([
    ["POST", "/api/attachments/presign"],
    ["POST", "/api/attachments/upload"],
    ["POST", "/api/attachments/confirm"],
    ["PUT", "/api/avatar"],
    ["POST", "/api/editor-images"],
    ["POST", "/api/docs/ABC/pages/cl123/file"],
  ])("blocks %s %s", (method, p) => {
    expect(blockedBySwitch(p, method, off)).toBe("UPLOADS_ENABLED");
  });

  it.each([
    ["GET", "/api/attachments"],
    ["GET", "/api/attachments/abc/url"],
    ["DELETE", "/api/attachments/abc"],
    ["GET", "/api/avatar"],
    ["GET", "/api/editor-images"],
    ["GET", "/api/docs/ABC/pages/cl123/file"],
    ["POST", "/api/docs/ABC/pages"], // ordinary doc writes are not uploads
  ])("leaves %s %s alone", (method, p) => {
    expect(blockedBySwitch(p, method, off)).toBeNull();
  });
});

describe("route inventory", () => {
  const API = path.join(__dirname, "..", "app", "api");

  function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? routeFiles(full) : e.name === "route.ts" ? [full] : [];
    });
  }

  /** Turn a route file into a representative URL: [param] -> "x". */
  function urlOf(file: string): string {
    const rel = path.relative(path.join(__dirname, ".."), path.dirname(file)).split(path.sep).slice(1);
    return "/" + rel.map((seg) => (seg.startsWith("[") ? "x" : seg)).join("/");
  }

  const files = routeFiles(API);

  it("every route that writes to S3 is behind UPLOADS_ENABLED for each write method it exports", () => {
    const writers = files.filter((f) => /\b(putObject|getPresignedUploadUrl)\b/.test(fs.readFileSync(f, "utf8")));
    expect(writers.length).toBeGreaterThan(0);
    for (const f of writers) {
      const src = fs.readFileSync(f, "utf8");
      const methods = (src.match(/export async function (POST|PUT|PATCH)\b/g) ?? []).map((m) => m.split(" ").pop()!);
      expect(methods.length, `${f} writes to S3 but exports no write handler`).toBeGreaterThan(0);
      for (const m of methods) {
        expect(killSwitchFor(urlOf(f), m), `${m} ${urlOf(f)} uploads to S3 but has no kill switch`).toBe("UPLOADS_ENABLED");
      }
    }
  });

  it("every external API route is behind EXTERNAL_API_ENABLED", () => {
    const ext = files.filter((f) => urlOf(f).startsWith("/api/external/"));
    expect(ext.length).toBeGreaterThan(0);
    for (const f of ext) expect(killSwitchFor(urlOf(f), "GET")).toBe("EXTERNAL_API_ENABLED");
  });

  it("every OAuth and MCP route is behind OAUTH_MCP_ENABLED", () => {
    const oauth = files.filter((f) => /^\/api\/(oauth|mcp)(\/|$)/.test(urlOf(f)));
    expect(oauth.length).toBeGreaterThan(0);
    for (const f of oauth) expect(killSwitchFor(urlOf(f), "POST")).toBe("OAUTH_MCP_ENABLED");
  });

  it("every well-known route is behind OAUTH_MCP_ENABLED", () => {
    const dir = path.join(__dirname, "..", "app", "well-known");
    for (const f of routeFiles(dir)) {
      const url = "/.well-known/" + path.relative(dir, path.dirname(f)).split(path.sep).join("/");
      expect(killSwitchFor(url, "GET"), url).toBe("OAUTH_MCP_ENABLED");
    }
  });
});

describe("middleware wiring", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "middleware.ts"), "utf8");
  it("consults the switches and answers 503 before any handler or auth redirect", () => {
    expect(SRC).toMatch(/blockedBySwitch\(/);
    expect(SRC).toMatch(/status:\s*503/);
    expect(SRC.indexOf("blockedBySwitch(")).toBeLessThan(SRC.indexOf("if (isApiRoute) return"));
    expect(SRC.indexOf("blockedBySwitch(")).toBeLessThan(SRC.indexOf("if (!isLoggedIn)"));
  });
});
