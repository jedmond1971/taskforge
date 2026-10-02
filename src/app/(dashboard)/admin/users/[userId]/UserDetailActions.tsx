"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, KeyRound, FolderPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserActionDialogs, type UserAction, type UserActionTarget } from "../UserActionDialogs";

export function UserDetailActions({ user }: { user: UserActionTarget }) {
  const router = useRouter();
  const [action, setAction] = useState<UserAction | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setAction("edit")}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
        <Button variant="outline" onClick={() => setAction("reset")}>
          <KeyRound className="w-3.5 h-3.5 mr-1.5" />
          Reset password
        </Button>
        <Button variant="outline" onClick={() => setAction("addToProject")}>
          <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
          Add to project
        </Button>
        <Button variant="outline" onClick={() => setAction("delete")}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5 text-danger" />
          <span className="text-danger">Delete</span>
        </Button>
      </div>
      <UserActionDialogs
        user={user}
        action={action}
        onClose={() => setAction(null)}
        onDone={(done) => (done === "delete" ? router.push("/admin/users") : router.refresh())}
      />
    </>
  );
}
