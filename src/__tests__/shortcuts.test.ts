// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { GO_CHORD_TARGETS, SHORTCUTS, SHORTCUT_SCOPES, shouldIgnoreShortcut } from "@/lib/shortcuts";

function keyEvent(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, ...init });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("shortcut registry", () => {
  it("has unique ids and unique key sequences", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    const seqs = SHORTCUTS.map((s) => s.keys.join(" "));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("only uses known scopes and has a description for each", () => {
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_SCOPES).toContain(s.scope);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("documents every go-to chord target and nothing else", () => {
    const documented = SHORTCUTS.filter((s) => s.keys[0] === "G").map((s) => s.keys[1].toLowerCase());
    expect(documented.sort()).toEqual(Object.keys(GO_CHORD_TARGETS).sort());
  });

  it("does not let a plain letter shortcut collide with the G chord prefix", () => {
    const singles = SHORTCUTS.filter((s) => s.keys.length === 1).map((s) => s.keys[0].toLowerCase());
    expect(singles).not.toContain("g");
  });
});

describe("shouldIgnoreShortcut", () => {
  it("ignores typing targets, modifiers, repeats", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(shouldIgnoreShortcut(keyEvent({ key: "n" }, document.createElement(tag)))).toBe(true);
    }
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(shouldIgnoreShortcut(keyEvent({ key: "n" }, editable))).toBe(true);
    expect(shouldIgnoreShortcut(keyEvent({ key: "c", ctrlKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(keyEvent({ key: "c", metaKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(keyEvent({ key: "n", repeat: true }))).toBe(true);
  });

  it("ignores everything while a dialog is open, allows it otherwise", () => {
    const body = document.body;
    expect(shouldIgnoreShortcut(keyEvent({ key: "n" }, body))).toBe(false);
    expect(shouldIgnoreShortcut(keyEvent({ key: "?", shiftKey: true }, body))).toBe(false);
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    body.appendChild(dlg);
    try {
      expect(shouldIgnoreShortcut(keyEvent({ key: "n" }, body))).toBe(true);
    } finally {
      dlg.remove();
    }
  });
});
