import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { PageHeader } from "@/components/ui/page-header";


export default async function SettingsPage() {
  const session = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, avatarUrl: true },
  });

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Settings" subtitle="Manage your account preferences" />

      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Profile picture</h2>
        </div>
        <AvatarUpload currentImage={user?.avatarUrl} userName={user?.name} />
      </div>

      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Change password</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Other active sessions (other browsers or devices) will be signed out immediately. This session stays active.
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
