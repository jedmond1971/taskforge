"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { QueryBar } from "@/components/query/QueryBar";
import { QueryResults } from "@/components/query/QueryResults";
import { SavedFilters } from "@/components/query/SavedFilters";
import { runQuery } from "./actions";
import { saveFilter, updateFilter } from "./filter-actions";
import type { QueryResult } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FilterData {
  id: string;
  name: string;
  query: string;
  userId: string;
  isGlobal: boolean;
  user: { id: string; name: string };
}

interface SearchPageClientProps {
  filters: FilterData[];
  currentUserId: string;
}

export function SearchPageClient({
  filters,
  currentUserId,
}: SearchPageClientProps) {
  const router = useRouter();
  const [results, setResults] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [filterIsGlobal, setFilterIsGlobal] = useState(false);
  const [editingFilter, setEditingFilter] = useState<{
    id: string;
    name: string;
    query: string;
    isGlobal: boolean;
  } | null>(null);

  const handleExecute = useCallback(
    async (query: string) => {
      setCurrentQuery(query);
      setIsLoading(true);
      try {
        const result = await runQuery(query);
        if (result.success) {
          setResults(result.data);
        } else {
          toast.error(result.errors[0]?.message ?? "Query failed");
          setResults(null);
        }
      } catch {
        toast.error("Failed to execute query");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleRunFilter = useCallback(
    (query: string) => {
      setCurrentQuery(query);
      handleExecute(query);
    },
    [handleExecute]
  );

  function handleOpenSaveDialog() {
    if (!currentQuery.trim()) {
      toast.error("Run a query first before saving");
      return;
    }
    setEditingFilter(null);
    setFilterName("");
    setFilterIsGlobal(false);
    setSaveDialogOpen(true);
  }

  async function handleSaveFilter() {
    if (!filterName.trim()) {
      toast.error("Filter name is required");
      return;
    }
    try {
      if (editingFilter) {
        await updateFilter(editingFilter.id, {
          name: filterName,
          isGlobal: filterIsGlobal,
        });
        toast.success("Filter updated");
      } else {
        await saveFilter(filterName, currentQuery, filterIsGlobal);
        toast.success("Filter saved");
      }
      setSaveDialogOpen(false);
      setEditingFilter(null);
      setFilterName("");
      setFilterIsGlobal(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save filter"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Search Issues</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Search issues across all your projects using powerful query syntax
        </p>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Sidebar with filters */}
        <div className="space-y-4">
          <SavedFilters
            filters={filters}
            currentUserId={currentUserId}
            onRunFilter={handleRunFilter}
            onEditFilter={(f) => {
              setEditingFilter(f);
              setSaveDialogOpen(true);
              setFilterName(f.name);
              setFilterIsGlobal(f.isGlobal);
            }}
          />
        </div>

        {/* Main content */}
        <div className="space-y-4">
          <QueryBar
            onExecute={handleExecute}
            onSave={handleOpenSaveDialog}
            defaultQuery={currentQuery}
            isLoading={isLoading}
          />

          {results && <QueryResults results={results} isLoading={isLoading} />}

          {!results && !isLoading && (
            <div className="flex flex-col items-center gap-3 py-16">
              <Search className="w-12 h-12 text-zinc-700" />
              <p className="text-lg font-medium text-zinc-600 dark:text-zinc-500">
                Search for issues
              </p>
              <p className="text-sm text-zinc-600">
                Enter a query above or select a filter to get started
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Save Filter Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-900 dark:text-zinc-100">
              {editingFilter ? "Edit Filter" : "Save Filter"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Filter name
              </label>
              <Input
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="My custom filter"
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Query
              </label>
              <div className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 font-mono">
                {editingFilter?.query ?? currentQuery}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterIsGlobal}
                onChange={(e) => setFilterIsGlobal(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                Share with all users
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSaveDialogOpen(false);
                  setEditingFilter(null);
                }}
                className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveFilter}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {editingFilter ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
