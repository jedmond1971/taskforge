import { getAdminAuditLog } from "../actions";
import { AdminAuditLogClient } from "./AdminAuditLogClient";

export default async function AdminAuditLogPage() {
  const entries = await getAdminAuditLog();
  return <AdminAuditLogClient initialEntries={entries} />;
}
