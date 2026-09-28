"use client";

import { useRouter } from "next/navigation";
import { Pencil, Trash2, ListFilter } from "lucide-react";
import { toast } from "sonner";
import { deleteFilter } from "@/app/(dashboard)/search/filter-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { MonoMeta } from "@/components/ui/mono-meta";

interface SavedFilter {
  id: string;
  name: string;
  query: string;
  userId: string;
  isGlobal: boolean;
  user: { id: string; name: string };
}

interface SavedFiltersProps {
  filters: SavedFilter[];
  currentUserId: string;
  onRunFilter: (query: string) => void;
  onEditFilter?: (filter: {
    id: string;
    name: string;
    query: string;
    isGlobal: boolean;
  }) => void;
}

const quickFilters = [
  {
    name: "My Open Issues",
    query: 'assignee = currentUser() AND status != "DONE"',
  },
  {
    name: "Recently Updated",
    query: "updatedAt >= startOfWeek() ORDER BY updatedAt DESC",
  },
  {
    name: "High Priority",
    query: 'priority IN ("CRITICAL", "HIGH") AND status != "DONE"',
  },
  {
    name: "Unassigned",
    query: 'assignee = EMPTY AND status != "DONE"',
  },
];

export function SavedFilters({
  filters,
  currentUserId,
  onRunFilter,
  onEditFilter,
}: SavedFiltersProps) {
  const router = useRouter();

  const myFilters = filters.filter((f) => f.userId === currentUserId);
  const globalFilters = filters.filter(
    (f) => f.isGlobal && f.userId !== currentUserId
  );

  async function handleDelete(filterId: string) {
    try {
      await deleteFilter(filterId);
      toast.success("Filter deleted");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete filter"
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Quick Filters */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Quick Filters
        </h3>
        <div className="space-y-1">
          {quickFilters.map((qf) => (
            <button
              key={qf.name}
              onClick={() => onRunFilter(qf.query)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-active transition-colors group"
            >
              <p className="text-sm text-foreground group-hover:text-primary/80 transition-colors">
                {qf.name}
              </p>
              <MonoMeta className="truncate mt-0.5 block">
                {qf.query}
              </MonoMeta>
            </button>
          ))}
        </div>
      </div>

      {/* My Filters */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          My Filters
        </h3>
        {myFilters.length === 0 ? (
          <EmptyState
            icon={ListFilter}
            title="No saved filters yet"
            message="Run a query, then save it to reuse it later."
            className="py-6"
          />
        ) : (
          <div className="space-y-1">
            {myFilters.map((f) => (
              <div
                key={f.id}
                className="px-3 py-2 rounded-lg hover:bg-surface-active transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onRunFilter(f.query)}
                    className="text-sm text-foreground group-hover:text-primary/80 transition-colors text-left flex-1 truncate"
                  >
                    {f.name}
                    {f.isGlobal && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        (shared)
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditFilter && (
                      <button
                        onClick={() => onEditFilter(f)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-1 text-muted-foreground hover:text-danger"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <MonoMeta className="truncate mt-0.5 block">
                  {f.query}
                </MonoMeta>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Global Filters */}
      {globalFilters.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Shared Filters
          </h3>
          <div className="space-y-1">
            {globalFilters.map((f) => (
              <div
                key={f.id}
                className="px-3 py-2 rounded-lg hover:bg-surface-active transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onRunFilter(f.query)}
                    className="text-sm text-foreground group-hover:text-primary/80 transition-colors text-left flex-1 truncate"
                  >
                    {f.name}
                  </button>
                </div>
                <MonoMeta className="truncate mt-0.5 block">
                  {f.query}
                </MonoMeta>
                <p className="text-xs text-muted-foreground mt-0.5">
                  by {f.user.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
