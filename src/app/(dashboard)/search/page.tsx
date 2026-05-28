import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SearchPageClient } from "./SearchPageClient";

export default async function SearchPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Saved filters are now project-scoped. The global search page has no project
  // context, so filters are unavailable here. Filter save/load is accessible
  // from within individual project views.
  return (
    <SearchPageClient
      filters={[]}
      currentUserId={session.user.id}
    />
  );
}
