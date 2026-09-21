import { getAdminProjects } from "../actions";
import { requireUser } from "@/lib/auth";
import { AdminProjectsClient } from "./AdminProjectsClient";


export default async function AdminProjectsPage() {
  await requireUser();
  const projects = await getAdminProjects();

  return <AdminProjectsClient initialProjects={projects} />;
}
