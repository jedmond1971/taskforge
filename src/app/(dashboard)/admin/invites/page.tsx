import { getAdminInvites, adminGetOrgsForSelect } from "../actions";
import { requireUser } from "@/lib/auth";
import { AdminInvitesClient } from "./AdminInvitesClient";


export default async function AdminInvitesPage() {
  await requireUser();
  const [invites, orgs] = await Promise.all([
    getAdminInvites(),
    adminGetOrgsForSelect(),
  ]);

  return <AdminInvitesClient initialInvites={invites} orgs={orgs} />;
}
