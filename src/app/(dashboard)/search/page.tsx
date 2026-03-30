import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyFilters } from "./filter-actions";
import { SearchPageClient } from "./SearchPageClient";

export default async function SearchPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const filters = await getMyFilters();

  return (
    <SearchPageClient
      filters={filters.map((f) => ({
        id: f.id,
        name: f.name,
        query: f.query,
        userId: f.userId,
        isGlobal: f.isGlobal,
        user: f.user,
      }))}
      currentUserId={session.user.id}
    />
  );
}
