import { Resend } from "resend";
import { render } from "@react-email/components";
import { OrgInviteEmail } from "@/emails/OrgInviteEmail";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@prisma/client";

export type InviteLookupResult =
  | { status: "NOT_FOUND" }
  | { status: "EXPIRED"; orgName: string }
  | { status: "ALREADY_ACCEPTED"; orgName: string }
  | { status: "VALID"; orgId: string; orgName: string; email: string; role: OrgRole; token: string };

export async function getInviteWithStatus(token: string): Promise<InviteLookupResult> {
  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    include: { org: { select: { id: true, name: true } } },
  });
  if (!invite) return { status: "NOT_FOUND" };
  if (invite.accepted) return { status: "ALREADY_ACCEPTED", orgName: invite.org.name };
  if (invite.expiresAt < new Date()) return { status: "EXPIRED", orgName: invite.org.name };
  return { status: "VALID", orgId: invite.org.id, orgName: invite.org.name, email: invite.email, role: invite.role, token: invite.token };
}

export const INVITE_EXPIRY_DAYS = 14;

export function getInviteExpiryDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + INVITE_EXPIRY_DAYS);
  return d;
}

export async function sendOrgInviteEmail(params: {
  to: string;
  orgName: string;
  inviterName: string;
  token: string;
  expiresAt: Date;
}): Promise<{ success: boolean; error?: string }> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://www.jedforge.com";
  const acceptUrl = `${baseUrl}/invite/${params.token}`;
  try {
    const html = await render(
      OrgInviteEmail({
        orgName: params.orgName,
        inviterName: params.inviterName,
        acceptUrl,
        expiresAt: params.expiresAt,
      })
    );
    const result = await resend.emails.send({
      from: "JedForge <invites@jedforge.com>",
      to: params.to,
      subject: `You've been invited to join ${params.orgName} on JedForge`,
      html,
    });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
