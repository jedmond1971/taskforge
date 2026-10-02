import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MonoMeta } from "@/components/ui/mono-meta";
import { SetPageTitle } from "@/components/layout/PageTitleContext";
import { getAdminUserDetail } from "../../actions";
import { UserDetailActions } from "./UserDetailActions";

function label(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function fmt(d: Date | null) {
  return d ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "Never";
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6 space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default async function AdminUserDetailPage(props: { params: Promise<{ userId: string }> }) {
  await requireUser();
  const { userId } = await props.params;
  const user = await getAdminUserDetail(userId);
  if (!user) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <SetPageTitle title={user.name} />

      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Users
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar className="w-16 h-16">
            <AvatarImage src={user.avatarUrl ?? undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">{user.name}</h1>
            <p className="text-sm text-muted-foreground break-all">{user.email}</p>
            <Badge
              className={
                user.role === "ADMIN"
                  ? "mt-2 bg-primary/20 text-primary border-primary/30"
                  : "mt-2 bg-surface-active text-muted-foreground border-border-soft"
              }
            >
              {user.role}
            </Badge>
          </div>
        </div>
        <UserDetailActions user={{ id: user.id, name: user.name, email: user.email, role: user.role }} />
      </div>

      <Panel title="Activity">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Member since</dt>
          <dd className="text-foreground">{fmt(user.createdAt)}</dd>
          <dt className="text-muted-foreground">Last activity</dt>
          <dd className="text-foreground">{fmt(user.lastActivityAt)}</dd>
          <dt className="text-muted-foreground">Assigned issues</dt>
          <dd className="text-foreground">{user._count.assignedIssues}</dd>
          <dt className="text-muted-foreground">Reported issues</dt>
          <dd className="text-foreground">{user._count.reportedIssues}</dd>
          <dt className="text-muted-foreground">Comments</dt>
          <dd className="text-foreground">{user._count.comments}</dd>
        </dl>
      </Panel>

      <Panel title="Organizations">
        {user.orgMembers.length === 0 ? (
          <Empty>Not a member of any organization.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.orgMembers.map((m) => (
              <li key={m.org.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/admin/orgs/${m.org.id}`} className="text-foreground hover:underline">
                  {m.org.name}
                </Link>
                <MonoMeta>{label(m.role)}</MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Projects">
        {user.projectMembers.length === 0 ? (
          <Empty>Not a member of any project.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.projectMembers.map((m) => (
              <li key={m.project.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">
                  {m.project.name}
                  <MonoMeta className="ml-2">{m.project.key}</MonoMeta>
                  <MonoMeta className="ml-2">{m.project.org.name}</MonoMeta>
                  {m.project.isClosed && <MonoMeta className="ml-2">Closed</MonoMeta>}
                </span>
                <MonoMeta className="flex-shrink-0">{label(m.role)}</MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Groups">
        {user.groupMemberships.length === 0 ? (
          <Empty>Not in any group.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.groupMemberships.map(({ group }) => (
              <li key={group.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-foreground">{group.name}</span>
                <MonoMeta>{group.org.name}</MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="API keys created">
        {user.apiKeys.length === 0 ? (
          <Empty>No API keys.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.apiKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">
                  {k.name}
                  <MonoMeta className="ml-2">{k.org.name}</MonoMeta>
                </span>
                <MonoMeta className="flex-shrink-0">
                  {k.revokedAt ? `Revoked ${fmt(k.revokedAt)}` : `Last used ${fmt(k.lastUsedAt)}`}
                </MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
