"use client";

import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteFilter } from "@/app/(dashboard)/search/filter-actions";

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
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
          Quick Filters
        </h3>
        <div className="space-y-1">
          {quickFilters.map((qf) => (
            <button
              key={qf.name}
              onClick={() => onRunFilter(qf.query)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
            >
              <p className="text-sm text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-400 transition-colors">
                {qf.name}
              </p>
              <p className="text-xs text-zinc-600 font-mono truncate mt-0.5">
                {qf.query}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* My Filters */}
      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
          My Filters
        </h3>
        {myFilters.length === 0 ? (
          <p className="text-xs text-zinc-600 px-3">No saved filters yet</p>
        ) : (
          <div className="space-y-1">
            {myFilters.map((f) => (
              <div
                key={f.id}
                className="px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onRunFilter(f.query)}
                    className="text-sm text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-400 transition-colors text-left flex-1 truncate"
                  >
                    {f.name}
                    {f.isGlobal && (
                      <span className="ml-1.5 text-xs text-zinc-600">
                        (shared)
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditFilter && (
                      <button
                        onClick={() => onEditFilter(f)}
                        className="p-1 text-zinc-500 hover:text-zinc-300"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-1 text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-600 font-mono truncate mt-0.5">
                  {f.query}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Global Filters */}
      {globalFilters.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            Shared Filters
          </h3>
          <div className="space-y-1">
            {globalFilters.map((f) => (
              <div
                key={f.id}
                className="px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onRunFilter(f.query)}
                    className="text-sm text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-400 transition-colors text-left flex-1 truncate"
                  >
                    {f.name}
                  </button>
                </div>
                <p className="text-xs text-zinc-600 font-mono truncate mt-0.5">
                  {f.query}
                </p>
                <p className="text-xs text-zinc-700 mt-0.5">
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
