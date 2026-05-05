import { getAdminOrgs } from "../actions";
import { prisma } from "@/lib/prisma";
import { AdminOrgsClient } from "./AdminOrgsClient";

export default async function AdminOrgsPage() {
  const [orgs, allUsers] = await Promise.all([
    getAdminOrgs(),
    prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return <AdminOrgsClient initialOrgs={orgs} allUsers={allUsers} />;
}
