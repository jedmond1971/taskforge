"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  BookOpen,
  Lock,
} from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { DocsSearchBar } from "./docs-search-bar";
import { DocVisibilityToggle } from "./doc-visibility-toggle";
import { CreateDocItemButtons } from "./create-doc-item-buttons";
import { DocTypeIcon } from "@/components/docs/doc-type-icon";
import { cn } from "@/lib/utils";

interface SidebarPage {
  id: string;
  title: string;
  type: string;
  mimeType?: string | null;
}

interface SidebarSection {
  id: string;
  title: string;
  pages: SidebarPage[];
}

interface DocsSidebarLayoutProps {
  projectKey: string;
  sections: SidebarSection[];
  pages: SidebarPage[];
  canEdit: boolean;
  canManage: boolean;
  isPublic: boolean;
  isClosed?: boolean;
  children: React.ReactNode;
}

// Sentinel droppable id for the unsectioned-pages zone — never a real cuid.
const UNSECTIONED_ID = "UNSECTIONED";

// Prefer whatever's directly under the pointer, fall back to rect overlap.
const customCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function DocsSidebarLayout({
  projectKey,
  sections,
  pages,
  canEdit,
  canManage,
  isPublic,
  isClosed,
  children,
}: DocsSidebarLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(sections.map((s) => [s.id, true]))
  );

  const [localPages, setLocalPages] = useState<SidebarPage[]>(pages);
  const [localSections, setLocalSections] = useState<SidebarSection[]>(sections);
  const [activePage, setActivePage] = useState<SidebarPage | null>(null);
  const [dragOrigin, setDragOrigin] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Sync server-refreshed props into local state, but not while a drag is in flight
  useEffect(() => {
    if (!activePage) {
      setLocalPages(pages);
      setLocalSections(sections);
    }
  }, [pages, sections]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSection(id: string) {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function getList(listId: string): SidebarPage[] {
    if (listId === UNSECTIONED_ID) return localPages;
    return localSections.find((s) => s.id === listId)?.pages ?? [];
  }

  function setListPages(listId: string, newPages: SidebarPage[]) {
    if (listId === UNSECTIONED_ID) {
      setLocalPages(newPages);
    } else {
      setLocalSections((prev) =>
        prev.map((s) => (s.id === listId ? { ...s, pages: newPages } : s))
      );
    }
  }

  // Resolve which list an id belongs to: a section id, UNSECTIONED, or (for a page id)
  // whichever list currently contains it.
  function resolveListId(id: string): string | undefined {
    if (id === UNSECTIONED_ID) return UNSECTIONED_ID;
    if (localSections.some((s) => s.id === id)) return id;
    if (localPages.some((p) => p.id === id)) return UNSECTIONED_ID;
    for (const s of localSections) {
      if (s.pages.some((p) => p.id === id)) return s.id;
    }
    return undefined;
  }

  function moveToList(page: SidebarPage, fromListId: string, toListId: string) {
    if (fromListId === UNSECTIONED_ID) {
      setLocalPages((prev) => prev.filter((p) => p.id !== page.id));
    } else {
      setLocalSections((prev) =>
        prev.map((s) =>
          s.id === fromListId ? { ...s, pages: s.pages.filter((p) => p.id !== page.id) } : s
        )
      );
    }
    if (toListId === UNSECTIONED_ID) {
      setLocalPages((prev) => [...prev, page]);
    } else {
      setLocalSections((prev) =>
        prev.map((s) => (s.id === toListId ? { ...s, pages: [...s.pages, page] } : s))
      );
    }
  }

  async function patchPage(pageId: string, body: { sectionId?: string | null; position?: number }) {
    const res = await fetch(`/api/docs/${projectKey}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to update page");
  }

  // DocPage has a DB-level DEFERRABLE UNIQUE(sectionId, position) constraint (plus a
  // non-deferrable partial unique index for sectionId IS NULL pages) — see the
  // 20260601000000_position_uniqueness migration. Each PATCH here is its own request/
  // transaction, so the deferred check still fires per-statement: writing a page straight
  // to an index another page in the list currently holds 409s. Renumber the whole
  // destination list through a large temporary offset first (nobody collides there), then
  // assign final 0..N-1 positions once every row in the list has vacated its old slot.
  async function persistListOrder(
    orderedPages: SidebarPage[],
    draggedPageId: string | null,
    destSectionId: string | null | undefined
  ) {
    const OFFSET = 1_000_000;
    for (let i = 0; i < orderedPages.length; i++) {
      const p = orderedPages[i];
      const body: { position: number; sectionId?: string | null } = { position: OFFSET + i };
      if (destSectionId !== undefined && p.id === draggedPageId) body.sectionId = destSectionId;
      await patchPage(p.id, body);
    }
    for (let i = 0; i < orderedPages.length; i++) {
      await patchPage(orderedPages[i].id, { position: i });
    }
  }

  function handleDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const listId = resolveListId(id);
    if (!listId) return;
    const page =
      listId === UNSECTIONED_ID
        ? localPages.find((p) => p.id === id)
        : localSections.find((s) => s.id === listId)?.pages.find((p) => p.id === id);
    setActivePage(page ?? null);
    setDragOrigin(listId);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || active.id === over.id) return;

    const activeListId = resolveListId(String(active.id));
    const destListId = resolveListId(String(over.id));
    if (!activeListId || !destListId || activeListId === destListId) return;

    const page = getList(activeListId).find((p) => p.id === active.id);
    if (!page) return;

    moveToList(page, activeListId, destListId);
  }

  function handleDragEnd({ over }: DragEndEvent) {
    const draggedPage = activePage;
    const originListId = dragOrigin;
    setActivePage(null);
    setDragOrigin(null);
    if (!over || !draggedPage || !originListId) return;

    const destListId = resolveListId(String(over.id)) ?? originListId;
    const destListBefore = getList(destListId);
    const alreadyInDest = destListBefore.some((p) => p.id === draggedPage.id);
    const workingList = alreadyInDest ? destListBefore : [...destListBefore, draggedPage];

    const oldIndex = workingList.findIndex((p) => p.id === draggedPage.id);
    const overIndex = workingList.findIndex((p) => p.id === String(over.id));
    const newIndex = overIndex === -1 ? workingList.length - 1 : overIndex;
    const finalList = oldIndex === newIndex ? workingList : arrayMove(workingList, oldIndex, newIndex);

    const crossSection = destListId !== originListId;
    if (!crossSection && oldIndex === newIndex) return;

    setListPages(destListId, finalList);

    if (destListId !== UNSECTIONED_ID && !expandedSections[destListId]) {
      setExpandedSections((prev) => ({ ...prev, [destListId]: true }));
    }

    const rollback = () => {
      setLocalPages(pages);
      setLocalSections(sections);
      toast.error("Failed to move page");
    };

    setIsSaving(true);

    const destSectionId = crossSection ? (destListId === UNSECTIONED_ID ? null : destListId) : undefined;
    void (async () => {
      try {
        await persistListOrder(finalList, crossSection ? draggedPage.id : null, destSectionId);
        router.refresh();
      } catch {
        rollback();
      } finally {
        setIsSaving(false);
      }
    })();
  }

  // Extract pageId from pathname: /projects/[key]/docs/[pageId]
  const pathParts = pathname.split("/");
  const activePageId =
    pathParts[1] === "projects" && pathParts[3] === "docs" && pathParts[4]
      ? pathParts[4]
      : null;

  const isDocsHome = pathname === `/projects/${projectKey}/docs`;

  return (
    <div className="flex -m-4 sm:-m-6">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[calc(100vh-12rem)]">
        {/* Closed banner */}
        {isClosed && (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
            <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Project closed · read-only</span>
          </div>
        )}
        {/* Search */}
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <DocsSearchBar projectKey={projectKey} />
        </div>

        {/* Create */}
        {canEdit && (
          <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <CreateDocItemButtons projectKey={projectKey} variant="sidebar" />
          </div>
        )}

        {/* Nav tree */}
        <DndContext
          sensors={sensors}
          collisionDetection={customCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <nav className="flex-1 p-2 space-y-0.5">
            {/* Docs home — not a drop target, must keep navigating on click */}
            <Link
              href={`/projects/${projectKey}/docs`}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                isDocsHome
                  ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All pages</span>
            </Link>

            {/* Unsectioned pages */}
            <DroppableZone id={UNSECTIONED_ID} disabled={!canEdit} className="rounded-md transition-colors">
              <SortableContext items={localPages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                {localPages.map((page) => (
                  <SortableSidebarPageItem
                    key={page.id}
                    page={page}
                    projectKey={projectKey}
                    isActive={activePageId === page.id}
                    disabled={!canEdit}
                  />
                ))}
              </SortableContext>
              {canEdit && localPages.length === 0 && (
                <p className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-600 italic border border-dashed border-zinc-200 dark:border-zinc-700 rounded-md text-center">
                  Drop here to remove from a section
                </p>
              )}
            </DroppableZone>

            {/* Sections */}
            {localSections.map((section) => (
              <DroppableZone
                key={section.id}
                id={section.id}
                disabled={!canEdit}
                className="pt-1 rounded-md transition-colors"
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                >
                  {expandedSections[section.id] ? (
                    <ChevronDown className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 flex-shrink-0" />
                  )}
                  <FolderOpen className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate text-left">{section.title}</span>
                </button>

                {expandedSections[section.id] && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    <SortableContext items={section.pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                      {section.pages.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-zinc-400 italic">No pages</p>
                      ) : (
                        section.pages.map((page) => (
                          <SortableSidebarPageItem
                            key={page.id}
                            page={page}
                            projectKey={projectKey}
                            isActive={activePageId === page.id}
                            disabled={!canEdit}
                          />
                        ))
                      )}
                    </SortableContext>
                  </div>
                )}
              </DroppableZone>
            ))}
          </nav>

          {/* Drag overlay — the floating item shown while dragging */}
          <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
            {activePage && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl shadow-black/30 cursor-grabbing">
                <DocTypeIcon type={activePage.type} mimeType={activePage.mimeType} size={14} />
                <span className="truncate">{activePage.title}</span>
              </div>
            )}
          </DragOverlay>

          {isSaving && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2 shadow-lg z-50">
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Saving...
            </div>
          )}
        </DndContext>

        {/* Footer: visibility */}
        {canManage && (
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
            <DocVisibilityToggle
              projectKey={projectKey}
              initialIsPublic={isPublic}
            />
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}

function DroppableZone({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && !disabled && "bg-orange-50/60 dark:bg-orange-950/20")}
    >
      {children}
    </div>
  );
}

function SortableSidebarPageItem({
  page,
  projectKey,
  isActive,
  disabled,
}: {
  page: SidebarPage;
  projectKey: string;
  isActive: boolean;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        !disabled && "touch-none cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <SidebarPageItem page={page} projectKey={projectKey} isActive={isActive} />
    </div>
  );
}

function SidebarPageItem({
  page,
  projectKey,
  isActive,
}: {
  page: SidebarPage;
  projectKey: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/projects/${projectKey}/docs/${page.id}`}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
        isActive
          ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 font-medium"
          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      <DocTypeIcon type={page.type} mimeType={page.mimeType} size={14} />
      <span className="truncate">{page.title}</span>
    </Link>
  );
}
