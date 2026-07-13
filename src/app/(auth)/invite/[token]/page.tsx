import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInviteWithStatus } from "@/lib/invites";
import { InviteAcceptClient } from "./InviteAcceptClient";

const accentLine = (
  <div
    className="absolute top-0 rounded-sm"
    style={{
      left: "10%",
      right: "10%",
      height: "1px",
      background: "linear-gradient(90deg, transparent, rgba(240,90,40,0.55), transparent)",
    }}
  />
);

function ErrorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
      {accentLine}
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{title}</h1>
        <div className="text-zinc-500 dark:text-zinc-400 text-sm">{children}</div>
      </div>
    </div>
  );
}

type Mode = "new-user" | "existing-matching" | "existing-mismatch" | "needs-login";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const invite = await getInviteWithStatus(token);

  if (invite.status === "NOT_FOUND") {
    return (
      <ErrorCard title="Invalid Invite">
        <p>This invite link isn&apos;t valid.</p>
      </ErrorCard>
    );
  }

  if (invite.status === "EXPIRED") {
    return (
      <ErrorCard title="Invite Expired">
        <p>This invite to join <strong>{invite.orgName}</strong> has expired. Ask an admin to send a new one.</p>
      </ErrorCard>
    );
  }

  if (invite.status === "ALREADY_ACCEPTED") {
    return (
      <ErrorCard title="Already Accepted">
        <p>This invite has already been used.</p>
        <Link
          href="/login"
          className="inline-block mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium underline underline-offset-4"
        >
          Go to login
        </Link>
      </ErrorCard>
    );
  }

  const { orgName, email } = invite;
  const session = await auth();

  let mode: Mode;
  let currentSessionEmail: string | null = null;

  if (session?.user) {
    currentSessionEmail = session.user.email ?? null;
    if (session.user.email?.toLowerCase() === email.toLowerCase()) {
      mode = "existing-matching";
    } else {
      mode = "existing-mismatch";
    }
  } else {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    mode = existingUser ? "needs-login" : "new-user";
  }

  return (
    <InviteAcceptClient
      token={token}
      orgName={orgName}
      email={email}
      mode={mode}
      currentSessionEmail={currentSessionEmail}
    />
  );
}
