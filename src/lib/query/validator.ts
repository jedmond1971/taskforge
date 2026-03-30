import type { ParseResult, ASTNode, ComparisonNode, Operator, ValueNode } from "./parser";

export interface ValidationError {
  message: string;
  suggestion?: string;
}

const KNOWN_FIELDS = [
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

const ORDERABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "priority",
  "status",
  "key",
  "title",
  "type",
];

const FIELD_OPERATORS: Record<string, Operator[]> = {
  status: ["=", "!=", "IN", "NOT IN"],
  priority: ["=", "!=", "IN", "NOT IN"],
  type: ["=", "!=", "IN", "NOT IN"],
  key: ["=", "!=", "IN", "NOT IN"],
  project: ["=", "!=", "IN", "NOT IN"],
  assignee: ["=", "!=", "IN", "NOT IN"],
  reporter: ["=", "!=", "IN", "NOT IN"],
  title: ["=", "!=", "~"],
  description: ["=", "!=", "~"],
  labels: ["=", "!=", "~", "IN", "NOT IN"],
  createdAt: ["=", "!=", ">", "<", ">=", "<="],
  updatedAt: ["=", "!=", ">", "<", ">=", "<="],
};

const STATUS_VALUES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
const PRIORITY_VALUES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const TYPE_VALUES = ["BUG", "TASK", "STORY", "EPIC"];

const DATE_FUNCTIONS = ["now", "startOfDay", "startOfWeek", "startOfMonth"];
const NULLABLE_FIELDS = ["assignee", "description", "labels"];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function findClosestField(field: string): string | undefined {
  let closest: string | undefined;
  let minDist = Infinity;
  const lower = field.toLowerCase();
  for (const known of KNOWN_FIELDS) {
    const dist = levenshtein(lower, known.toLowerCase());
    if (dist < minDist) {
      minDist = dist;
      closest = known;
    }
  }
  return minDist <= 3 ? closest : undefined;
}

function validateValue(
  field: string,
  value: ValueNode,
  errors: ValidationError[]
): void {
  if (value.type === "empty") {
    if (!NULLABLE_FIELDS.includes(field)) {
      errors.push({
        message: `EMPTY is not valid for field '${field}'. EMPTY can only be used with: ${NULLABLE_FIELDS.join(", ")}`,
      });
    }
    return;
  }

  if (value.type === "function") {
    const name = value.name;
    if (name === "currentUser") {
      if (field !== "assignee" && field !== "reporter") {
        errors.push({
          message: `currentUser() can only be used with 'assignee' or 'reporter' fields, not '${field}'`,
        });
      }
    } else if (DATE_FUNCTIONS.includes(name)) {
      if (field !== "createdAt" && field !== "updatedAt") {
        errors.push({
          message: `${name}() can only be used with 'createdAt' or 'updatedAt' fields, not '${field}'`,
        });
      }
    }
    return;
  }

  if (value.type === "string") {
    const upper = value.value.toUpperCase();
    if (field === "status" && !STATUS_VALUES.includes(upper)) {
      errors.push({
        message: `Invalid status value '${value.value}'. Valid values: ${STATUS_VALUES.join(", ")}`,
      });
    }
    if (field === "priority" && !PRIORITY_VALUES.includes(upper)) {
      errors.push({
        message: `Invalid priority value '${value.value}'. Valid values: ${PRIORITY_VALUES.join(", ")}`,
      });
    }
    if (field === "type" && !TYPE_VALUES.includes(upper)) {
      errors.push({
        message: `Invalid type value '${value.value}'. Valid values: ${TYPE_VALUES.join(", ")}`,
      });
    }
    return;
  }

  if (value.type === "list") {
    for (const item of value.values) {
      validateValue(field, item, errors);
    }
  }
}

function validateNode(node: ASTNode, errors: ValidationError[]): void {
  if (node.type === "comparison") {
    validateComparison(node, errors);
  } else if (node.type === "logical") {
    validateNode(node.left, errors);
    validateNode(node.right, errors);
  } else if (node.type === "group") {
    validateNode(node.expression, errors);
  }
}

function validateComparison(
  node: ComparisonNode,
  errors: ValidationError[]
): void {
  const { field, operator, value } = node;

  // Check field is known (parser already validates, but just in case)
  if (!KNOWN_FIELDS.includes(field)) {
    const suggestion = findClosestField(field);
    errors.push({
      message: `Unknown field '${field}'`,
      suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
    });
    return;
  }

  // Check operator compatibility
  const allowedOps = FIELD_OPERATORS[field];
  if (allowedOps && !allowedOps.includes(operator)) {
    errors.push({
      message: `Operator '${operator}' is not valid for field '${field}'. Allowed operators: ${allowedOps.join(", ")}`,
    });
  }

  // Check value compatibility
  validateValue(field, value, errors);
}

export function validate(result: ParseResult): ValidationError[] {
  const errors: ValidationError[] = [];

  if (result.where) {
    validateNode(result.where, errors);
  }

  for (const clause of result.orderBy) {
    if (!KNOWN_FIELDS.includes(clause.field)) {
      const suggestion = findClosestField(clause.field);
      errors.push({
        message: `Unknown ORDER BY field '${clause.field}'`,
        suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
      });
    } else if (!ORDERABLE_FIELDS.includes(clause.field)) {
      errors.push({
        message: `Field '${clause.field}' cannot be used in ORDER BY. Allowed fields: ${ORDERABLE_FIELDS.join(", ")}`,
      });
    }
  }

  return errors;
}
