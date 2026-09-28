"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, Send, Wrench, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ToolCall = {
  name: string;
  serverName: string;
  input: unknown;
  resultSummary: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[] | null;
};

interface AiChatPanelProps {
  issueId: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function toolCallLabel(call: ToolCall): string {
  if (call.name === "create_issue") {
    const input = call.input as { title?: string } | null;
    return input?.title ? `create_issue → ${input.title}` : "create_issue";
  }
  if (call.name === "write_doc_page") {
    const input = call.input as { title?: string } | null;
    return input?.title ? `write_doc_page → ${input.title}` : "write_doc_page";
  }
  return call.name;
}

export function AiChatPanel({ issueId, collapsed, onToggleCollapse }: AiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  useEffect(() => {
    function updateHeight() {
      const el = panelRef.current;
      if (!el) return;
      if (collapsed || !window.matchMedia("(min-width: 1536px)").matches) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(400, window.innerHeight - top - 24)}px`;
    }
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    setIsHydrating(true);
    fetch(`/api/ai/conversations?issueId=${issueId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load chat history");
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isLoading]);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setIsLoading(true);

    fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueId, message: trimmed }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message, toolCalls: data.toolCalls },
        ]);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "The assistant failed to reply");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Please try again." },
        ]);
      })
      .finally(() => setIsLoading(false));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col",
        collapsed && "2xl:p-2 2xl:items-center"
      )}
    >
      <div className={cn("flex items-center gap-2 mb-3", collapsed && "2xl:mb-0")}>
        <Bot className={cn("w-4 h-4 text-primary shrink-0", collapsed && "2xl:hidden")} />
        <p className={cn("text-xs font-medium text-zinc-500 dark:text-zinc-400 flex-1", collapsed && "2xl:hidden")}>
          Ask AI about this issue
        </p>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="hidden 2xl:flex p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
            aria-label={collapsed ? "Expand AI chat panel" : "Collapse AI chat panel"}
            title={collapsed ? "Expand AI chat panel" : "Collapse AI chat panel"}
          >
            {collapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className={cn("flex-1 min-h-0 overflow-y-auto space-y-3 mb-3 pr-1", collapsed && "2xl:hidden")}
      >
        {isHydrating ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600">
            Ask a question about this issue, or ask Claude to create a related sub-issue or doc page.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%] space-y-1">
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.toolCalls.map((call, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                        title={call.resultSummary}
                      >
                        <Wrench className="w-2.5 h-2.5" />
                        {toolCallLabel(call)}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 bg-zinc-100 dark:bg-zinc-800">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className={cn("flex items-end gap-2", collapsed && "2xl:hidden")}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question… (Shift+Enter for a new line)"
          disabled={isLoading}
          className="flex-1 min-w-0 max-h-40 resize-none overflow-y-auto text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={isLoading || !input.trim()}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </form>
    </div>
  );
}
