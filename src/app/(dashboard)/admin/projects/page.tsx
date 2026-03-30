import { getAdminProjects } from "../actions";
import { AdminProjectsClient } from "./AdminProjectsClient";

export default async function AdminProjectsPage() {
  const projects = await getAdminProjects();

  return <AdminProjectsClient initialProjects={projects} />;
}
