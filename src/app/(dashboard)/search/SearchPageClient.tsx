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
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

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
  projectId?: string;
}

export function SearchPageClient({
  filters,
  currentUserId,
  projectId,
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
    if (!projectId) {
      toast.error("Filters can only be saved from within a project");
      return;
    }
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
        if (!projectId) throw new Error("No project context");
        await saveFilter(filterName, currentQuery, filterIsGlobal, projectId);
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
      <PageHeader
        title="Search Issues"
        subtitle="Search issues across all your projects using powerful query syntax"
      />

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
            <EmptyState
              icon={Search}
              title="Search for issues"
              message="Enter a query above or select a filter to get started"
              className="py-16"
            />
          )}
        </div>
      </div>

      {/* Save Filter Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFilter ? "Edit Filter" : "Save Filter"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Filter name
              </label>
              <Input
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="My custom filter"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Query
              </label>
              <div className="px-3 py-2 bg-surface-active border border-border-soft rounded-lg text-sm text-muted-foreground font-mono">
                {editingFilter?.query ?? currentQuery}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterIsGlobal}
                onChange={(e) => setFilterIsGlobal(e.target.checked)}
                className="rounded border-border bg-background text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">
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
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveFilter}
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
