import { describe, it, expect } from "vitest";
import { parse, ParseError } from "../parser";
import type { ComparisonNode, LogicalNode, GroupNode } from "../parser";

describe("Query Parser", () => {
  describe("simple comparisons", () => {
    it('parses status = "TODO"', () => {
      const result = parse('status = "TODO"');
      expect(result.where).not.toBeNull();
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("status");
      expect(node.operator).toBe("=");
      expect(node.value).toEqual({ type: "string", value: "TODO" });
    });

    it('parses priority != "LOW"', () => {
      const result = parse('priority != "LOW"');
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("priority");
      expect(node.operator).toBe("!=");
      expect(node.value).toEqual({ type: "string", value: "LOW" });
    });

    it('parses title ~ "login"', () => {
      const result = parse('title ~ "login"');
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("title");
      expect(node.operator).toBe("~");
      expect(node.value).toEqual({ type: "string", value: "login" });
    });

    it("parses assignee = EMPTY", () => {
      const result = parse("assignee = EMPTY");
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("assignee");
      expect(node.operator).toBe("=");
      expect(node.value).toEqual({ type: "empty" });
    });

    it("parses assignee = currentUser()", () => {
      const result = parse("assignee = currentUser()");
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("assignee");
      expect(node.operator).toBe("=");
      expect(node.value).toEqual({ type: "function", name: "currentUser" });
    });

    it("parses createdAt >= startOfWeek()", () => {
      const result = parse("createdAt >= startOfWeek()");
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("createdAt");
      expect(node.operator).toBe(">=");
      expect(node.value).toEqual({ type: "function", name: "startOfWeek" });
    });

    it('parses status IN ("TODO", "IN_PROGRESS")', () => {
      const result = parse('status IN ("TODO", "IN_PROGRESS")');
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("status");
      expect(node.operator).toBe("IN");
      expect(node.value).toEqual({
        type: "list",
        values: [
          { type: "string", value: "TODO" },
          { type: "string", value: "IN_PROGRESS" },
        ],
      });
    });

    it('parses status NOT IN ("DONE")', () => {
      const result = parse('status NOT IN ("DONE")');
      const node = result.where as ComparisonNode;
      expect(node.type).toBe("comparison");
      expect(node.field).toBe("status");
      expect(node.operator).toBe("NOT IN");
      expect(node.value).toEqual({
        type: "list",
        values: [{ type: "string", value: "DONE" }],
      });
    });
  });

  describe("logical operators", () => {
    it("parses AND expressions", () => {
      const result = parse('status = "TODO" AND priority = "HIGH"');
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("AND");
      expect((node.left as ComparisonNode).field).toBe("status");
      expect((node.right as ComparisonNode).field).toBe("priority");
    });

    it("parses OR expressions", () => {
      const result = parse('status = "TODO" OR status = "IN_PROGRESS"');
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("OR");
      expect((node.left as ComparisonNode).field).toBe("status");
      expect((node.right as ComparisonNode).field).toBe("status");
    });

    it("AND binds tighter than OR", () => {
      // a OR b AND c  →  a OR (b AND c)
      const result = parse(
        'status = "TODO" OR priority = "HIGH" AND type = "BUG"'
      );
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("OR");
      expect((node.left as ComparisonNode).field).toBe("status");
      const right = node.right as LogicalNode;
      expect(right.type).toBe("logical");
      expect(right.operator).toBe("AND");
      expect((right.left as ComparisonNode).field).toBe("priority");
      expect((right.right as ComparisonNode).field).toBe("type");
    });

    it("parentheses override precedence", () => {
      // (a OR b) AND c
      const result = parse(
        '(status = "TODO" OR priority = "HIGH") AND type = "BUG"'
      );
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("AND");
      const left = node.left as GroupNode;
      expect(left.type).toBe("group");
      const inner = left.expression as LogicalNode;
      expect(inner.operator).toBe("OR");
      expect((node.right as ComparisonNode).field).toBe("type");
    });
  });

  describe("ORDER BY", () => {
    it("parses ORDER BY priority DESC", () => {
      const result = parse(
        'status = "TODO" ORDER BY priority DESC'
      );
      expect(result.orderBy).toEqual([
        { field: "priority", direction: "DESC" },
      ]);
    });

    it("parses multiple ORDER BY fields", () => {
      const result = parse(
        'status = "TODO" ORDER BY priority DESC, createdAt ASC'
      );
      expect(result.orderBy).toEqual([
        { field: "priority", direction: "DESC" },
        { field: "createdAt", direction: "ASC" },
      ]);
    });

    it("defaults direction to ASC", () => {
      const result = parse('status = "TODO" ORDER BY priority');
      expect(result.orderBy).toEqual([
        { field: "priority", direction: "ASC" },
      ]);
    });
  });

  describe("error handling", () => {
    it("throws on invalid field name", () => {
      expect(() => parse('foobar = "test"')).toThrow(ParseError);
      try {
        parse('foobar = "test"');
      } catch (e) {
        expect((e as ParseError).message).toContain("Unknown field");
      }
    });

    it("throws on missing value", () => {
      expect(() => parse("status =")).toThrow(ParseError);
    });

    it("throws on unclosed string", () => {
      expect(() => parse('status = "unclosed')).toThrow(ParseError);
      try {
        parse('status = "unclosed');
      } catch (e) {
        expect((e as ParseError).message).toContain("Unclosed string");
      }
    });

    it("throws on invalid operator", () => {
      expect(() => parse('status "TODO"')).toThrow(ParseError);
    });

    it("returns empty result for empty query", () => {
      const result = parse("");
      expect(result.where).toBeNull();
      expect(result.orderBy).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("handles case-insensitive keywords", () => {
      const result = parse('status = "TODO" and priority = "HIGH"');
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("AND");

      const result2 = parse('status = "TODO" Or priority = "HIGH"');
      const node2 = result2.where as LogicalNode;
      expect(node2.operator).toBe("OR");
    });

    it("handles whitespace variations", () => {
      const result = parse('  status="TODO"   AND   priority="HIGH"  ');
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("AND");
    });

    it("parses complex nested expressions", () => {
      const result = parse(
        '(status = "TODO" OR status = "IN_PROGRESS") AND (priority = "HIGH" OR priority = "CRITICAL") ORDER BY createdAt DESC'
      );
      const node = result.where as LogicalNode;
      expect(node.type).toBe("logical");
      expect(node.operator).toBe("AND");
      expect((node.left as GroupNode).type).toBe("group");
      expect((node.right as GroupNode).type).toBe("group");
      expect(result.orderBy).toEqual([
        { field: "createdAt", direction: "DESC" },
      ]);
    });

    it("handles case-insensitive field names", () => {
      const result = parse('Status = "TODO"');
      const node = result.where as ComparisonNode;
      expect(node.field).toBe("status");
    });

    it("handles ORDER BY only (no where clause)", () => {
      const result = parse("ORDER BY createdAt DESC");
      expect(result.where).toBeNull();
      expect(result.orderBy).toEqual([
        { field: "createdAt", direction: "DESC" },
      ]);
    });

    it("handles whitespace-only query", () => {
      const result = parse("   ");
      expect(result.where).toBeNull();
      expect(result.orderBy).toEqual([]);
    });
  });
});
