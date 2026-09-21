import { DashboardShell } from "@/components/layout/DashboardShell";
import { requireUser } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <DashboardShell>{children}</DashboardShell>;
}
