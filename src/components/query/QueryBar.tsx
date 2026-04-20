"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Search, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAutocompleteSuggestions } from "@/app/(dashboard)/search/actions";

interface QueryBarProps {
  onExecute: (query: string) => void;
  onSave?: (query: string) => void;
  defaultQuery?: string;
  isLoading?: boolean;
}

const HISTORY_KEY = "jedforge-query-history";
const MAX_HISTORY = 5;

const FIELDS = new Set([
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
]);

const KEYWORDS = new Set(["AND", "OR", "ORDER", "BY", "NOT", "IN"]);
const OPERATORS = new Set(["=", "!=", ">", "<", ">=", "<=", "~"]);
const SORT_DIRS = new Set(["ASC", "DESC"]);

interface HighlightToken {
  text: string;
  type: "field" | "operator" | "string" | "keyword" | "function" | "empty" | "sortdir" | "plain";
}

function tokenizeForHighlight(input: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let i = 0;

  while (i < input.length) {
    // Whitespace
    if (/\s/.test(input[i])) {
      let ws = "";
      while (i < input.length && /\s/.test(input[i])) {
        ws += input[i];
        i++;
      }
      tokens.push({ text: ws, type: "plain" });
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
      tokens.push({ text: str, type: "string" });
      continue;
    }

    // Parentheses and commas
    if ("(),".includes(input[i])) {
      tokens.push({ text: input[i], type: "plain" });
      i++;
      continue;
    }

    // Operators
    if (">=<!~".includes(input[i])) {
      let op = input[i];
      i++;
      if (i < input.length && input[i] === "=") {
        op += "=";
        i++;
      }
      tokens.push({ text: op, type: "operator" });
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
      tokens.push({ text: word, type: "function" });
      continue;
    }

    if (!word) {
      // Unknown character, skip
      tokens.push({ text: input[i], type: "plain" });
      i++;
      continue;
    }

    // Classify the word
    if (word === "EMPTY") {
      tokens.push({ text: word, type: "empty" });
    } else if (FIELDS.has(word)) {
      tokens.push({ text: word, type: "field" });
    } else if (KEYWORDS.has(word.toUpperCase())) {
      tokens.push({ text: word, type: "keyword" });
    } else if (OPERATORS.has(word)) {
      tokens.push({ text: word, type: "operator" });
    } else if (SORT_DIRS.has(word.toUpperCase())) {
      tokens.push({ text: word, type: "sortdir" });
    } else {
      tokens.push({ text: word, type: "plain" });
    }
  }

  return tokens;
}

function getTokenClassName(type: HighlightToken["type"]): string {
  switch (type) {
    case "field":
      return "text-blue-400";
    case "operator":
      return "text-zinc-500";
    case "string":
      return "text-emerald-400";
    case "keyword":
      return "text-purple-400";
    case "function":
      return "text-amber-400";
    case "empty":
      return "text-amber-400";
    case "sortdir":
      return "text-zinc-400";
    default:
      return "text-zinc-900 dark:text-zinc-100";
  }
}

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.slice(0, MAX_HISTORY);
    return [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY))
    );
  } catch {
    // Ignore storage errors
  }
}

export function QueryBar({
  onExecute,
  onSave,
  defaultQuery = "",
  isLoading = false,
}: QueryBarProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [errors, setErrors] = useState<
    Array<{ message: string; suggestion?: string }>
  >([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionType, setSuggestionType] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowAutocomplete(false);
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExecute = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    // Clear validation errors and dropdowns on execute
    setErrors([]);
    setShowAutocomplete(false);
    setShowHistory(false);
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }

    // Add to history
    const newHistory = [
      trimmed,
      ...history.filter((h) => h !== trimmed),
    ].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    saveHistory(newHistory);

    onExecute(trimmed);
  }, [query, isLoading, history, onExecute]);

  const fetchSuggestions = useCallback(
    (value: string, cursor: number) => {
      if (autocompleteTimerRef.current) {
        clearTimeout(autocompleteTimerRef.current);
      }
      autocompleteTimerRef.current = setTimeout(async () => {
        if (!value.trim()) {
          setShowAutocomplete(false);
          return;
        }
        try {
          const result = await getAutocompleteSuggestions(value, cursor);
          if (result.suggestions.length > 0) {
            setSuggestions(result.suggestions);
            setSuggestionType(result.type);
            setSelectedIndex(0);
            setShowAutocomplete(true);
            setShowHistory(false);
          } else {
            setShowAutocomplete(false);
          }
        } catch {
          setShowAutocomplete(false);
        }
      }, 200);
    },
    []
  );

  const validateQuery = useCallback((value: string) => {
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }
    if (!value.trim()) {
      setErrors([]);
      return;
    }
    validationTimerRef.current = setTimeout(async () => {
      try {
        // Dynamically import parse to avoid bundling server code
        const { parse, validate } = await import("@/lib/query");
        const parsed = parse(value);
        const validationErrors: Array<{ message: string; suggestion?: string }> = validate(parsed);
        if (validationErrors.length > 0) {
          setErrors(
            validationErrors.map((e: { message: string; suggestion?: string }) => ({
              message: e.message,
              suggestion: e.suggestion,
            }))
          );
        } else {
          setErrors([]);
        }
      } catch (err) {
        if (err && typeof err === "object" && "message" in err) {
          const msg = (err as { message: string }).message;
          // Suppress errors that indicate incomplete input — the user is still typing.
          // "EOF" errors mean the parser ran out of tokens mid-expression;
          // "Unclosed string" means they're inside a quoted value.
          if (msg.includes("EOF") || msg.includes("Unclosed string")) return;
          setErrors([{ message: msg }]);
        }
      }
    }, 500);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      const cursor = e.target.selectionStart ?? value.length;
      fetchSuggestions(value, cursor);
      validateQuery(value);

      if (!value.trim()) {
        setShowAutocomplete(false);
      }
    },
    [fetchSuggestions, validateQuery]
  );

  const handleFocus = useCallback(() => {
    if (!query.trim() && history.length > 0) {
      setShowHistory(true);
      setShowAutocomplete(false);
    }
  }, [query, history.length]);

  const insertSuggestion = useCallback(
    (suggestion: string) => {
      const input = inputRef.current;
      if (!input) return;

      const cursor = input.selectionStart ?? query.length;
      const beforeCursor = query.slice(0, cursor);
      const afterCursor = query.slice(cursor);

      // Find the start of the current partial token
      const match = beforeCursor.match(/[a-zA-Z0-9_."(]*$/);
      const partialLength = match ? match[0].length : 0;
      const prefix = beforeCursor.slice(0, beforeCursor.length - partialLength);

      const newQuery = prefix + suggestion + " " + afterCursor.trimStart();
      setQuery(newQuery);
      setShowAutocomplete(false);

      // Set cursor position after inserted suggestion
      const newCursorPos = prefix.length + suggestion.length + 1;
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(newCursorPos, newCursorPos);
      });

      // Trigger new suggestions for the updated query
      fetchSuggestions(newQuery, newCursorPos);
    },
    [query, fetchSuggestions]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Ctrl/Cmd+Enter to execute
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExecute();
        return;
      }

      if (showAutocomplete && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertSuggestion(suggestions[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowAutocomplete(false);
          return;
        }
      }

      if (showHistory) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowHistory(false);
          return;
        }
      }

      // Plain Enter to execute
      if (e.key === "Enter") {
        e.preventDefault();
        handleExecute();
      }
    },
    [
      showAutocomplete,
      suggestions,
      selectedIndex,
      showHistory,
      handleExecute,
      insertSuggestion,
    ]
  );

  const highlightedTokens = tokenizeForHighlight(query);

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            {/* Syntax highlight overlay */}
            <pre
              className="absolute inset-0 pointer-events-none px-3 py-2 text-sm font-mono whitespace-pre overflow-hidden leading-6 m-0 rounded-lg border border-transparent"
              aria-hidden="true"
            >
              {highlightedTokens.map((token, i) => (
                <span key={i} className={getTokenClassName(token.type)}>
                  {token.text}
                </span>
              ))}
            </pre>
            {/* Actual input */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              placeholder='e.g. status = "TODO" AND priority = "HIGH"'
              className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm font-mono text-transparent caret-zinc-900 dark:caret-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 h-10 leading-6 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
              spellCheck={false}
              autoComplete="off"
            />
            {/* Autocomplete dropdown */}
            {showAutocomplete && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                {suggestionType && (
                  <p className="px-3 py-1.5 text-xs text-zinc-500 font-medium border-b border-zinc-200 dark:border-zinc-800">
                    {suggestionType === "field"
                      ? "Fields"
                      : suggestionType === "operator"
                        ? "Operators"
                        : suggestionType === "value"
                          ? "Values"
                          : "Keywords"}
                  </p>
                )}
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors",
                      i === selectedIndex
                        ? "bg-zinc-100 dark:bg-zinc-800 text-indigo-400"
                        : "text-zinc-700 dark:text-zinc-300"
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSuggestion(s);
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            onClick={handleExecute}
            disabled={isLoading || !query.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white flex-shrink-0"
          >
            <Search className="w-4 h-4 mr-1" />
            {isLoading ? "Searching..." : "Search"}
          </Button>
          {onSave && query.trim() && (
            <Button
              variant="outline"
              onClick={() => onSave(query)}
              className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 flex-shrink-0"
              size="icon"
            >
              <Bookmark className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      {/* Error display */}
      {errors.length > 0 && (
        <div className="text-xs text-red-400 space-y-1">
          {errors.map((e, i) => (
            <p key={i}>
              {e.message}
              {e.suggestion && (
                <span className="text-zinc-500">
                  {" "}
                  — Did you mean: {e.suggestion}?
                </span>
              )}
            </p>
          ))}
        </div>
      )}
      {/* History dropdown */}
      {showHistory && history.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5">
            <p className="text-xs text-zinc-500 font-medium">
              Recent searches
            </p>
            <button
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                setHistory([]);
                saveHistory([]);
                setShowHistory(false);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {history.map((q, i) => (
            <button
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(q);
                setShowHistory(false);
                inputRef.current?.focus();
              }}
              className="w-full text-left px-3 py-2 text-sm font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors border-t border-zinc-200 dark:border-zinc-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
