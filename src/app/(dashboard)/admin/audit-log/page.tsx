import { getAdminAuditLog } from "../actions";
import { requireUser } from "@/lib/auth";
import { AdminAuditLogClient } from "./AdminAuditLogClient";


export default async function AdminAuditLogPage() {
  await requireUser();
  const entries = await getAdminAuditLog();
  return <AdminAuditLogClient initialEntries={entries} />;
}
