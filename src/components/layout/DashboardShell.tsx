"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PageTitleProvider } from "./PageTitleContext";
import { ForgeMark } from "./ForgeMark";
import { CommandPalette } from "./CommandPalette";
import { Menu } from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "jedforge-sidebar-collapsed";

function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    // Ignore storage errors
  }
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Closes the mobile sidebar overlay on navigation; driven by route change,
    // not state derived from this component's own props.
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Syncing with localStorage, an external system — not derivable at render time.
    setCollapsed(loadSidebarCollapsed());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) saveSidebarCollapsed(collapsed);
  }, [collapsed, mounted]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      if (pathname === "/search") {
        window.dispatchEvent(new CustomEvent("jedforge:focus-search"));
      } else {
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return (
    <PageTitleProvider>
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:relative inset-y-0 left-0 z-30 transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          onClose={() => setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile-only top bar with hamburger */}
        <div className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-border-soft bg-surface flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-surface-active rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-foreground">
            <ForgeMark size={28} className="text-foreground" holeColor="var(--surface)" />
            <span className="text-sm font-semibold">JedForge</span>
          </div>
        </div>

        <Header />

        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          <div className="animate-page-in h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
    <CommandPalette />
    </PageTitleProvider>
  );
}
