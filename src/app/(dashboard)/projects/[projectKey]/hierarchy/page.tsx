import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getIssuesHierarchy } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { HierarchyView } from "@/components/issues/HierarchyView";


interface PageProps {
  params: Promise<{ projectKey: string }>;
}

export default async function HierarchyPage(props: PageProps) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const issues = await getIssuesHierarchy(params.projectKey);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Hierarchy
        </h2>
        <p className="text-zinc-500 text-sm">
          {issues.length} issue{issues.length !== 1 ? "s" : ""}
        </p>
      </div>
      <HierarchyView issues={issues} projectKey={params.projectKey} />
    </div>
  );
}
