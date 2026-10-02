import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { PageHeader } from "@/components/ui/page-header";
import { MonoMeta } from "@/components/ui/mono-meta";
import { EditNameForm } from "./EditNameForm";
import { ChangePasswordForm } from "../settings/ChangePasswordForm";

function label(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6 space-y-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default async function ProfilePage() {
  const session = await requireUser();

  // Own data only: every query is keyed on the session user's id.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
      orgMembers: {
        select: { role: true, org: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      projectMembers: {
        select: {
          role: true,
          project: { select: { key: true, name: true, isClosed: true, org: { select: { name: true } } } },
        },
        orderBy: { project: { name: "asc" } },
      },
      groupMemberships: {
        select: { group: { select: { id: true, name: true, org: { select: { name: true } } } } },
      },
    },
  });

  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="My Profile" subtitle="Your account, memberships and security" />

      <Panel title="Profile">
        <AvatarUpload currentImage={user.avatarUrl} userName={user.name} />
        <EditNameForm initialName={user.name} />
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="text-foreground break-all">{user.email}</dd>
          <dt className="text-muted-foreground">Platform role</dt>
          <dd className="text-foreground">{user.role === "ADMIN" ? "Administrator" : "Member"}</dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd className="text-foreground">{user.createdAt.toLocaleDateString("en-US", { dateStyle: "long" })}</dd>
        </dl>
      </Panel>

      <Panel title="Organizations">
        {user.orgMembers.length === 0 ? (
          <Empty>You are not a member of any organization.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.orgMembers.map((m) => (
              <li key={m.org.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-foreground">{m.org.name}</span>
                <MonoMeta>{label(m.role)}</MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Projects">
        {user.projectMembers.length === 0 ? (
          <Empty>You are not a member of any project.</Empty>
        ) : (
          <ul className="divide-y divide-border-soft">
            {user.projectMembers.map((m) => (
              <li key={m.project.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/projects/${m.project.key}`} className="min-w-0 truncate text-foreground hover:underline">
                  {m.project.name}
                  <MonoMeta className="ml-2">{m.project.key}</MonoMeta>
                  {m.project.isClosed && <MonoMeta className="ml-2">Closed</MonoMeta>}
                </Link>
                <MonoMeta className="flex-shrink-0">{label(m.role)}</MonoMeta>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Groups">
        {user.groupMemberships.length === 0 ? (
          <Empty>You are not in any group.</Empty>
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

      <Panel title="Change password">
        <p className="text-sm text-muted-foreground -mt-2">
          Other active sessions (other browsers or devices) will be signed out immediately. This session stays active.
        </p>
        <ChangePasswordForm />
      </Panel>
    </div>
  );
}
