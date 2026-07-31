import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canViewProject } from "@/lib/permissions";
import { mintInternalMcpToken } from "@/lib/ai/internal-token";
import { isAiChatEnabled } from "@/lib/ai/feature-flag";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ToolCallSummary = {
  name: string;
  serverName: string;
  input: unknown;
  resultSummary: string;
};


export async function POST(request: NextRequest) {
  if (!isAiChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const issueId: unknown = body?.issueId;
  const message: unknown = body?.message;
  if (typeof issueId !== "string" || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "issueId and message are required" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      labels: true,
      project: { select: { id: true, key: true, orgId: true } },
      projectStatus: { select: { name: true } },
      customFieldValues: {
        select: {
          textValue: true,
          numberValue: true,
          dateValue: true,
          boolValue: true,
          selectValue: true,
          customField: { select: { name: true, type: true } },
        },
      },
    },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  try {
    await requireProjectRole(issue.project.key, canViewProject);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = session.user.id;

  const conversation = await prisma.aiConversation.upsert({
    where: { userId_issueId: { userId, issueId } },
    create: { userId, issueId },
    update: {},
  });

  const priorMessages = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: "user", content: message },
  });

  const conversationHistory: Anthropic.Beta.BetaMessageParam[] = [
    ...priorMessages.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  const customFieldLines = issue.customFieldValues
    .map((v) => {
      const value = v.textValue ?? v.selectValue ?? v.numberValue ?? v.boolValue ?? v.dateValue;
      if (value === null || value === undefined) return null;
      return `- ${v.customField.name}: ${value instanceof Date ? value.toISOString() : value}`;
    })
    .filter((line): line is string => line !== null);

  const systemPrompt = `You are an embedded assistant inside JedForge, a project management tool, helping the user think through and act on this specific issue from the issue detail page.

Issue context:
- Key: ${issue.key}
- Title: ${issue.title}
- Description: ${issue.description ? stripHtml(issue.description) : "(no description)"}
- Status: ${issue.projectStatus.name}
- Priority: ${issue.priority}
- Type: ${issue.type}
- Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}
${customFieldLines.length > 0 ? `Custom fields:\n${customFieldLines.join("\n")}` : ""}

You have access to JedForge tools for searching issues, creating issues, and reading/listing/writing documentation pages.
You do not have an update_issue or add_comment tool yet — if the user wants a field on this issue changed, tell them to use the UI, don't attempt a workaround.`;

  const internalToken = await mintInternalMcpToken(userId, issue.project.orgId);

  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 2048,
      system: systemPrompt,
      messages: conversationHistory,
      mcp_servers: [
        {
          type: "url",
          url: "https://www.jedforge.com/api/mcp",
          name: "jedforge",
          authorization_token: internalToken,
        },
      ],
      tools: [{ type: "mcp_toolset", mcp_server_name: "jedforge" }],
      betas: ["mcp-client-2025-11-20"],
    });
  } catch (error) {
    console.error("AI chat request failed:", error);
    return NextResponse.json(
      { error: "The assistant is unavailable right now. Please try again." },
      { status: 500 }
    );
  }

  const textParts: string[] = [];
  const toolCalls: ToolCallSummary[] = [];
  const toolUseById = new Map<string, { name: string; serverName: string; input: unknown }>();

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "mcp_tool_use") {
      toolUseById.set(block.id, { name: block.name, serverName: block.server_name, input: block.input });
    } else if (block.type === "mcp_tool_result") {
      const toolUse = toolUseById.get(block.tool_use_id);
      const resultText =
        typeof block.content === "string"
          ? block.content
          : block.content.map((c) => c.text).join(" ").trim();
      toolCalls.push({
        name: toolUse?.name ?? "unknown_tool",
        serverName: toolUse?.serverName ?? "jedforge",
        input: toolUse?.input ?? null,
        resultSummary: resultText.length > 300 ? `${resultText.slice(0, 300)}…` : resultText,
      });
    }
  }

  const replyText = textParts.join("\n\n").trim() || "(no response)";

  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: replyText,
      toolCalls: toolCalls.length > 0 ? (toolCalls as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  return NextResponse.json({ message: replyText, toolCalls });
}
