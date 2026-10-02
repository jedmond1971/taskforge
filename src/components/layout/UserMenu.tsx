"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Settings, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { data: session } = useSession();
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
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center h-9 w-9 sm:h-8 sm:w-8 rounded-full hover:bg-surface-active transition-colors flex-shrink-0"
        title={user?.name ?? "Account"}
        aria-label="Account menu"
      >
        <Avatar className="w-7 h-7">
          <AvatarImage src={user?.image ?? undefined} />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{user?.name ?? "Loading..."}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer p-0">
          <Link href="/profile" className="flex items-center w-full px-2 py-1.5">
            <User className="w-4 h-4 mr-2" />
            My Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer p-0">
          <Link href="/settings" className="flex items-center w-full px-2 py-1.5">
            <Settings className="w-4 h-4 mr-2" />
            Settings
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
  );
}
