import { prisma } from "@/lib/prisma";
import type { ParseResult, ASTNode, ValueNode, Operator } from "./parser";

export interface QueryContext {
  userId: string;
  memberProjectIds: string[];
}

export interface QueryResult {
  issues: Array<{
    id: string;
    key: string;
    title: string;
    status: string;
    priority: string;
    type: string;
    createdAt: Date;
    updatedAt: Date;
    assignee: { id: string; name: string; avatarUrl: string | null } | null;
    reporter: { id: string; name: string } | null;
    project: { id: string; key: string; name: string };
    _count: { comments: number };
  }>;
  total: number;
}

type PrismaWhere = Record<string, unknown>;

function resolveDateFunction(name: string): Date {
  const now = new Date();
  switch (name) {
    case "now":
      return now;
    case "startOfDay": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "startOfWeek": {
      const d = new Date(now);
      const day = d.getDay();
      // Monday = 1, Sunday = 0 → go back to Monday
      const diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "startOfMonth": {
      const d = new Date(now);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    default:
      return now;
  }
}

function resolveStringValue(value: ValueNode): string {
  if (value.type === "string") return value.value;
  return "";
}

function resolveStringValues(value: ValueNode): string[] {
  if (value.type === "list") {
    return value.values.map((v) => resolveStringValue(v));
  }
  return [resolveStringValue(value)];
}

async function resolveUserByIdentifier(
  identifier: string
): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: identifier, mode: "insensitive" } },
        { name: { equals: identifier, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? null;
}

function buildDateComparison(
  field: string,
  operator: Operator,
  value: ValueNode
): PrismaWhere {
  let date: Date;
  if (value.type === "function") {
    date = resolveDateFunction(value.name);
  } else if (value.type === "string") {
    date = new Date(value.value);
  } else {
    date = new Date();
  }

  const prismaField = field;
  switch (operator) {
    case "=":
      return { [prismaField]: { equals: date } };
    case "!=":
      return { NOT: { [prismaField]: { equals: date } } };
    case ">":
      return { [prismaField]: { gt: date } };
    case "<":
      return { [prismaField]: { lt: date } };
    case ">=":
      return { [prismaField]: { gte: date } };
    case "<=":
      return { [prismaField]: { lte: date } };
    default:
      return {};
  }
}

function buildTextComparison(
  field: string,
  operator: Operator,
  value: ValueNode
): PrismaWhere {
  const strValue = resolveStringValue(value);
  switch (operator) {
    case "=":
      return { [field]: { equals: strValue, mode: "insensitive" } };
    case "!=":
      return { NOT: { [field]: { equals: strValue, mode: "insensitive" } } };
    case "~":
      return { [field]: { contains: strValue, mode: "insensitive" } };
    default:
      return {};
  }
}

async function buildEnumComparison(
  field: string,
  operator: Operator,
  value: ValueNode
): Promise<PrismaWhere> {
  if (operator === "IN" || operator === "NOT IN") {
    const values = resolveStringValues(value).map((v) => v.toUpperCase());
    const clause = { [field]: { in: values } };
    return operator === "NOT IN" ? { NOT: clause } : clause;
  }
  const strValue = resolveStringValue(value).toUpperCase();
  if (operator === "=") {
    return { [field]: strValue };
  }
  if (operator === "!=") {
    return { NOT: { [field]: strValue } };
  }
  return {};
}

async function buildUserComparison(
  prismaField: string,
  operator: Operator,
  value: ValueNode,
  context: QueryContext
): Promise<PrismaWhere> {
  if (value.type === "empty") {
    if (operator === "=") return { [prismaField]: null };
    if (operator === "!=") return { NOT: { [prismaField]: null } };
    return {};
  }

  if (value.type === "function" && value.name === "currentUser") {
    if (operator === "=") return { [prismaField]: context.userId };
    if (operator === "!=") return { NOT: { [prismaField]: context.userId } };
    if (operator === "IN") return { [prismaField]: { in: [context.userId] } };
    if (operator === "NOT IN")
      return { NOT: { [prismaField]: { in: [context.userId] } } };
    return {};
  }

  if (operator === "IN" || operator === "NOT IN") {
    const identifiers = resolveStringValues(value);
    const userIds: string[] = [];
    for (const ident of identifiers) {
      const uid = await resolveUserByIdentifier(ident);
      if (uid) userIds.push(uid);
    }
    const clause = { [prismaField]: { in: userIds } };
    return operator === "NOT IN" ? { NOT: clause } : clause;
  }

  const strValue = resolveStringValue(value);
  const userId = await resolveUserByIdentifier(strValue);
  if (operator === "=") return { [prismaField]: userId };
  if (operator === "!=") return { NOT: { [prismaField]: userId } };
  return {};
}

async function buildNodeWhere(
  node: ASTNode,
  context: QueryContext
): Promise<PrismaWhere> {
  switch (node.type) {
    case "group":
      return buildNodeWhere(node.expression, context);

    case "logical": {
      const left = await buildNodeWhere(node.left, context);
      const right = await buildNodeWhere(node.right, context);
      if (node.operator === "AND") {
        return { AND: [left, right] };
      }
      return { OR: [left, right] };
    }

    case "comparison": {
      const { field, operator, value } = node;

      switch (field) {
        case "status":
        case "priority":
        case "type":
          return buildEnumComparison(field, operator, value);

        case "key": {
          if (operator === "IN" || operator === "NOT IN") {
            const values = resolveStringValues(value).map((v) =>
              v.toUpperCase()
            );
            const clause = { key: { in: values } };
            return operator === "NOT IN" ? { NOT: clause } : clause;
          }
          const keyValue = resolveStringValue(value).toUpperCase();
          if (operator === "=")
            return { key: { equals: keyValue, mode: "insensitive" } };
          if (operator === "!=")
            return {
              NOT: { key: { equals: keyValue, mode: "insensitive" } },
            };
          return {};
        }

        case "project": {
          if (operator === "IN" || operator === "NOT IN") {
            const values = resolveStringValues(value).map((v) =>
              v.toUpperCase()
            );
            const clause = { project: { key: { in: values } } };
            return operator === "NOT IN" ? { NOT: clause } : clause;
          }
          const projectKey = resolveStringValue(value).toUpperCase();
          if (operator === "=") return { project: { key: projectKey } };
          if (operator === "!=")
            return { NOT: { project: { key: projectKey } } };
          return {};
        }

        case "assignee":
          return buildUserComparison("assigneeId", operator, value, context);

        case "reporter":
          return buildUserComparison("reporterId", operator, value, context);

        case "title":
        case "description":
          return buildTextComparison(field, operator, value);

        case "labels": {
          if (value.type === "empty") {
            if (operator === "=") return { labels: { isEmpty: true } };
            if (operator === "!=") return { NOT: { labels: { isEmpty: true } } };
            return {};
          }
          if (operator === "=") {
            return { labels: { has: resolveStringValue(value) } };
          }
          if (operator === "!=") {
            return { NOT: { labels: { has: resolveStringValue(value) } } };
          }
          if (operator === "~") {
            return {
              labels: { hasSome: [resolveStringValue(value)] },
            };
          }
          if (operator === "IN") {
            return { labels: { hasSome: resolveStringValues(value) } };
          }
          if (operator === "NOT IN") {
            return {
              NOT: { labels: { hasSome: resolveStringValues(value) } },
            };
          }
          return {};
        }

        case "createdAt":
        case "updatedAt":
          return buildDateComparison(field, operator, value);

        default:
          return {};
      }
    }
  }
}

function buildOrderBy(
  orderBy: ParseResult["orderBy"]
): Record<string, string>[] {
  if (orderBy.length === 0) {
    return [{ createdAt: "desc" }];
  }

  return orderBy.map((clause) => ({
    [clause.field]: clause.direction.toLowerCase(),
  }));
}

export async function executeQuery(
  ast: ParseResult,
  context: QueryContext,
  limit?: number
): Promise<QueryResult> {
  const securityFilter: PrismaWhere = {
    projectId: { in: context.memberProjectIds },
  };

  let whereClause: PrismaWhere;
  if (ast.where) {
    const astWhere = await buildNodeWhere(ast.where, context);
    whereClause = { AND: [securityFilter, astWhere] };
  } else {
    whereClause = securityFilter;
  }

  const orderByClause = buildOrderBy(ast.orderBy);
  const take = limit ?? 100;

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where: whereClause,
      orderBy: orderByClause,
      take,
      include: {
        assignee: {
          select: { id: true, name: true, avatarUrl: true },
        },
        reporter: {
          select: { id: true, name: true },
        },
        project: {
          select: { id: true, key: true, name: true },
        },
        _count: {
          select: { comments: true },
        },
      },
    }),
    prisma.issue.count({ where: whereClause }),
  ]);

  return {
    issues: issues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      type: issue.type,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      assignee: issue.assignee
        ? {
            id: issue.assignee.id,
            name: issue.assignee.name ?? "",
            avatarUrl: (issue.assignee as Record<string, unknown>).avatarUrl as string | null,
          }
        : null,
      reporter: issue.reporter
        ? { id: issue.reporter.id, name: issue.reporter.name ?? "" }
        : null,
      project: {
        id: issue.project.id,
        key: issue.project.key,
        name: issue.project.name,
      },
      _count: { comments: issue._count.comments },
    })),
    total,
  };
}
