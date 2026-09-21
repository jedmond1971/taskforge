import { getAdminOrgs } from "../actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminOrgsClient } from "./AdminOrgsClient";


export default async function AdminOrgsPage() {
  await requireUser();
  const [orgs, allUsers] = await Promise.all([
    getAdminOrgs(),
    prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return <AdminOrgsClient initialOrgs={orgs} allUsers={allUsers} />;
}
