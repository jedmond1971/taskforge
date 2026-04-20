"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parse, ParseError, validate, executeQuery } from "@/lib/query";
import type { QueryResult, ValidationError } from "@/lib/query";

export type ExecuteQueryResult =
  | { success: true; data: QueryResult }
  | {
      success: false;
      errors: Array<{
        message: string;
        position?: number;
        suggestion?: string;
      }>;
    };

export async function runQuery(
  queryString: string
): Promise<ExecuteQueryResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Parse
  let parsed;
  try {
    parsed = parse(queryString);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      const parseErr = err as InstanceType<typeof ParseError>;
      return {
        success: false,
        errors: [{ message: parseErr.message, position: parseErr.position }],
      };
    }
    if (err instanceof Error) {
      return { success: false, errors: [{ message: err.message }] };
    }
    return { success: false, errors: [{ message: "Failed to parse query" }] };
  }

  // Validate
  const validationErrors: ValidationError[] = validate(parsed);
  if (validationErrors.length > 0) {
    return {
      success: false,
      errors: validationErrors.map((e) => ({
        message: e.message,
        suggestion: e.suggestion,
      })),
    };
  }

  // Get user's project memberships
  const memberships = await prisma.projectMember.findMany({
    where: { userId: session.user.id },
    select: { projectId: true },
  });
  const memberProjectIds = memberships.map((m) => m.projectId);

  if (memberProjectIds.length === 0) {
    return { success: true, data: { issues: [], total: 0 } };
  }

  // Execute
  const result = await executeQuery(
    parsed,
    {
      userId: session.user.id,
      memberProjectIds,
    },
    200
  );

  return { success: true, data: result };
}

export async function getAutocompleteSuggestions(
  queryString: string,
  cursorPosition: number
): Promise<{
  type: "field" | "operator" | "value" | "keyword";
  suggestions: string[];
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Analyze what's before the cursor
  const beforeCursor = queryString.slice(0, cursorPosition).trimEnd();
  const tokens = tokenizeForAutocomplete(beforeCursor);
  const lastToken = tokens[tokens.length - 1] ?? "";
  const secondLastToken = tokens[tokens.length - 2] ?? "";
  const thirdLastToken = tokens[tokens.length - 3] ?? "";

  const allFields = [
    "status",
    "priority",
    "type",
    "assignee",
    "reporter",
    "project",
    "title",
    "description",
    "labels",
    "createdAt",
    "updatedAt",
    "key",
  ];

  const operators = ["=", "!=", ">", "<", ">=", "<=", "~", "IN"];

  // If empty or after a logical operator -> suggest field names
  if (
    tokens.length === 0 ||
    ["AND", "OR", "("].includes(lastToken.toUpperCase())
  ) {
    return { type: "field", suggestions: allFields };
  }

  // If the cursor is inside an unclosed string literal (e.g. status = "TO|"),
  // detect the field from context and return relevant value suggestions.
  const isInsideString =
    lastToken.startsWith('"') &&
    (lastToken.length === 1 || !lastToken.endsWith('"') || lastToken.length < 2);
  if (isInsideString) {
    const field = operators.includes(secondLastToken)
      ? thirdLastToken.toLowerCase()
      : secondLastToken.toLowerCase();
    return {
      type: "value",
      suggestions: await getValueSuggestions(field, session.user.id),
    };
  }

  // If after a field name -> suggest operators
  const lastLower = lastToken.toLowerCase();
  if (allFields.includes(lastLower)) {
    const dateFields = ["createdat", "updatedat"];
    const textFields = ["title", "description"];
    if (dateFields.includes(lastLower)) {
      return {
        type: "operator",
        suggestions: ["=", "!=", ">", "<", ">=", "<="],
      };
    }
    if (textFields.includes(lastLower)) {
      return { type: "operator", suggestions: ["=", "!=", "~"] };
    }
    return { type: "operator", suggestions: ["=", "!=", "IN", "NOT IN"] };
  }

  // If after an operator -> suggest values
  if (
    operators.includes(lastToken) ||
    (lastToken.toUpperCase() === "IN" &&
      secondLastToken.toUpperCase() === "NOT")
  ) {
    // Determine field from context
    const field = operators.includes(secondLastToken)
      ? thirdLastToken.toLowerCase()
      : secondLastToken.toLowerCase();
    return {
      type: "value",
      suggestions: await getValueSuggestions(field, session.user.id),
    };
  }

  // After a comparison (field op value) -> suggest AND, OR, ORDER BY
  return { type: "keyword", suggestions: ["AND", "OR", "ORDER BY"] };
}

async function getValueSuggestions(
  field: string,
  userId: string
): Promise<string[]> {
  switch (field) {
    case "status":
      return ['"TODO"', '"IN_PROGRESS"', '"IN_REVIEW"', '"DONE"'];
    case "priority":
      return ['"CRITICAL"', '"HIGH"', '"MEDIUM"', '"LOW"'];
    case "type":
      return ['"BUG"', '"TASK"', '"STORY"', '"EPIC"'];
    case "assignee":
    case "reporter": {
      const users = await prisma.user.findMany({
        select: { email: true, name: true },
        take: 10,
      });
      return [
        "currentUser()",
        "EMPTY",
        ...users.map((u) => `"${u.email}"`),
      ];
    }
    case "project": {
      const projects = await prisma.projectMember.findMany({
        where: { userId },
        include: { project: { select: { key: true } } },
      });
      return projects.map((m) => `"${m.project.key}"`);
    }
    case "labels": {
      const memberships = await prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true },
      });
      const projectIds = memberships.map((m) => m.projectId);
      const issues = await prisma.issue.findMany({
        where: { projectId: { in: projectIds }, labels: { isEmpty: false } },
        select: { labels: true },
        take: 200,
      });
      const labelSet = new Set<string>();
      for (const issue of issues) {
        for (const label of issue.labels) labelSet.add(label);
      }
      return Array.from(labelSet).map((l) => `"${l}"`);
    }
    case "createdat":
    case "updatedat":
      return ["now()", "startOfDay()", "startOfWeek()", "startOfMonth()"];
    default:
      return [];
  }
}

function tokenizeForAutocomplete(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    // String literal
    if (input[i] === '"') {
      let str = '"';
      i++;
      while (i < input.length && input[i] !== '"') {
        str += input[i];
        i++;
      }
      if (i < input.length) {
        str += '"';
        i++;
      }
      tokens.push(str);
      continue;
    }
    // Parentheses
    if (input[i] === "(" || input[i] === ")") {
      tokens.push(input[i]);
      i++;
      continue;
    }
    // Operators: >=, <=, !=, =, >, <, ~
    if (">=<!~".includes(input[i])) {
      let op = input[i];
      i++;
      if (i < input.length && input[i] === "=") {
        op += "=";
        i++;
      }
      tokens.push(op);
      continue;
    }
    // Comma
    if (input[i] === ",") {
      tokens.push(",");
      i++;
      continue;
    }
    // Word
    let word = "";
    while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i])) {
      word += input[i];
      i++;
    }
    // Check for function call
    if (
      i < input.length &&
      input[i] === "(" &&
      i + 1 < input.length &&
      input[i + 1] === ")"
    ) {
      word += "()";
      i += 2;
    }
    if (word) tokens.push(word);
  }
  return tokens;
}
