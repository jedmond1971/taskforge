# AI Chat panel (JFR-111/112)

Issue-scoped chat with Claude embedded in the issue detail sidebar, with live access to the existing JedForge MCP tools via the Anthropic MCP connector. Gated behind `AI_CHAT_ENABLED` — see CLAUDE.md → Security constraints for why and where it's checked.

- **Only testable end-to-end on production.** Anthropic's servers call back into `https://www.jedforge.com/api/mcp` to execute MCP tool calls — they cannot reach `localhost`. Locally you can verify routes compile, the DB writes work, and the panel renders, but actual tool-use (Claude calling `create_issue`, `write_doc_page`, etc.) only works on jedforge.com.
- **`Anthropic.Beta.BetaMCPToolResultBlock.content` is `string | Array<BetaTextBlock>`, not always an array.** Code parsing MCP tool results (`src/app/api/ai/chat/route.ts`) must handle both — a tool result that's a plain string is a valid response shape, not an edge case to ignore.
- **`BetaMCPToolUseBlock` carries `server_name`, not `serverName`** — matches the wire format (snake_case), like the rest of this SDK's beta types.
- The chat route mints a short-lived (10 min) internal OAuth access token per request (`src/lib/ai/internal-token.ts`) and hands it to the MCP connector as `authorization_token`, reusing the same `OAuthAccessToken` machinery that backs the external MCP server (JFR-100). Any tool added to `src/lib/mcp/server.ts` is automatically available to the chat route with zero changes here.
- One `AiConversation` per `(userId, issueId)` pair — chat history is per-user, not shared across a project's members viewing the same issue.
