import { getAdminInvites, adminGetOrgsForSelect } from "../actions";
import { AdminInvitesClient } from "./AdminInvitesClient";

export default async function AdminInvitesPage() {
  const [invites, orgs] = await Promise.all([
    getAdminInvites(),
    adminGetOrgsForSelect(),
  ]);

  return <AdminInvitesClient initialInvites={invites} orgs={orgs} />;
}
