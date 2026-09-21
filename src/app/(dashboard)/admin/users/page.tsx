import { getAdminUsers } from "../actions";
import { requireUser } from "@/lib/auth";
import { AdminUsersClient } from "./AdminUsersClient";


export default async function AdminUsersPage() {
  await requireUser();
  const users = await getAdminUsers();

  return <AdminUsersClient initialUsers={users} />;
}
