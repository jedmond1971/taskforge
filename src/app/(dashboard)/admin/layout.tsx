import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" subtitle="Manage users and projects across JedForge" />
      {children}
    </div>
  );
}
