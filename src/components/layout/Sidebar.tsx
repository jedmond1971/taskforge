"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard,
  FolderKanban,
  FolderX,
  Search,
  BookOpen,
  ShieldCheck,
  LogOut,
  Settings,
  Building2,
  ChevronRight,
  ChevronDown,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Search", icon: Search },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

interface SidebarProps {
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [projectsExpanded, setProjectsExpanded] = useState(() =>
    pathname.startsWith("/projects")
  );

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";

  return (
    <div
      className={cn(
        "flex flex-col w-64 bg-sidebar border-r border-sidebar-border h-screen transition-[width] duration-300",
        collapsed && "lg:w-16"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center justify-between px-5 py-5 border-b border-sidebar-border",
          collapsed && "lg:flex-col lg:justify-center lg:gap-2 lg:px-2 lg:py-4"
        )}
      >
        <div className="flex items-center justify-center flex-1">
          <div className="dark:hidden">
            <img
              src="/logo-light.png"
              alt="JedForge"
              className={cn("h-28 w-auto", collapsed && "lg:hidden")}
            />
            <img
              src="/icons/light/icon-128.png"
              alt="JedForge"
              className={cn("hidden h-8 w-8", collapsed && "lg:block")}
            />
          </div>
          <div className="hidden dark:block">
            <img
              src="/logo-dark.png"
              alt="JedForge"
              className={cn("h-28 w-auto", collapsed && "lg:hidden")}
            />
            <img
              src="/icons/dark/icon-128.png"
              alt="JedForge"
              className={cn("hidden h-8 w-8", collapsed && "lg:block")}
            />
          </div>
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors flex-shrink-0"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-2.5 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : item.href === "/projects"
              ? pathname.startsWith("/projects") && !pathname.startsWith("/projects/closed")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]",
                collapsed && "lg:justify-center lg:px-2",
                isActive
                  ? "bg-sidebar-primary/20 text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
              {isActive && (
                <ChevronRight
                  className={cn(
                    "w-3 h-3 ml-auto text-sidebar-primary",
                    collapsed && "lg:hidden"
                  )}
                />
              )}
            </Link>
          );
        })}

        {/* Projects — expandable with Closed Projects nested below */}
        {(() => {
          const projectsActive =
            pathname.startsWith("/projects") && !pathname.startsWith("/projects/closed");
          const closedActive = pathname.startsWith("/projects/closed");
          return (
            <div>
              <div
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-colors",
                  projectsActive
                    ? "bg-sidebar-primary/20 text-sidebar-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Link
                  href="/projects"
                  title="Projects"
                  aria-label={collapsed ? "Projects" : undefined}
                  className={cn(
                    "flex items-center gap-3 flex-1 px-3 py-2.5 min-h-[44px]",
                    collapsed && "lg:justify-center lg:px-2"
                  )}
                >
                  <FolderKanban className="w-4 h-4 flex-shrink-0" />
                  <span className={cn(collapsed && "lg:hidden")}>Projects</span>
                </Link>
                <button
                  onClick={() => setProjectsExpanded((v) => !v)}
                  className={cn(
                    "px-2 py-2.5 rounded-r-lg",
                    collapsed && "lg:hidden"
                  )}
                  aria-label={projectsExpanded ? "Collapse projects" : "Expand projects"}
                >
                  {projectsExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {projectsExpanded && (
                <Link
                  href="/projects/closed"
                  className={cn(
                    "flex items-center gap-3 pl-8 pr-3 py-2 rounded-lg text-sm font-medium transition-colors min-h-[40px] mt-0.5",
                    collapsed && "lg:hidden",
                    closedActive
                      ? "bg-sidebar-primary/20 text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <FolderX className="w-4 h-4 flex-shrink-0" />
                  Closed Projects
                  {closedActive && <ChevronRight className="w-3 h-3 ml-auto text-sidebar-primary" />}
                </Link>
              )}
            </div>
          );
        })()}

        {/* Admin link — only visible to users with ADMIN role */}
        {user?.role === "ADMIN" && (
          <Link
            href="/admin"
            title="Admin"
            aria-label={collapsed ? "Admin" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]",
              collapsed && "lg:justify-center lg:px-2",
              pathname.startsWith("/admin")
                ? "bg-sidebar-primary/20 text-sidebar-foreground"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span className={cn(collapsed && "lg:hidden")}>Admin</span>
            {pathname.startsWith("/admin") && (
              <ChevronRight
                className={cn(
                  "w-3 h-3 ml-auto text-sidebar-primary",
                  collapsed && "lg:hidden"
                )}
              />
            )}
          </Link>
        )}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left",
              collapsed && "lg:justify-center lg:px-0"
            )}
            title={collapsed ? user?.name ?? "Account" : undefined}
            aria-label={collapsed ? user?.name ?? "Account menu" : undefined}
          >
            <Avatar className="w-7 h-7 flex-shrink-0">
              <AvatarImage src={user?.image ?? undefined} />
              <AvatarFallback className="bg-indigo-700 text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className={cn("flex-1 min-w-0", collapsed && "lg:hidden")}>
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user?.name ?? "Loading..."}
              </p>
              <p className="text-xs text-sidebar-foreground/70 truncate">{user?.email ?? ""}</p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="cursor-pointer p-0">
              <Link href="/settings" className="flex items-center w-full px-2 py-1.5">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer p-0">
              <Link href="/org-settings" className="flex items-center w-full px-2 py-1.5">
                <Building2 className="w-4 h-4 mr-2" />
                Org Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              variant="destructive"
              className="cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
