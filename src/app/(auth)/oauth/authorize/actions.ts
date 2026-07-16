"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateAuthorizeRequest } from "@/lib/oauth/validate-authorize-request";
import { parseRequestedScope } from "@/lib/oauth/scopes";
import { generateAuthorizationCode, hashOAuthSecret } from "@/lib/oauth/tokens";
import { AUTHORIZATION_CODE_TTL_MS } from "@/lib/oauth/config";

function appendRedirectParams(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

// Re-validates against the DB rather than trusting form fields, so a tampered
// hidden input can't redirect to an unregistered URI or skip PKCE.
async function revalidate(formData: FormData) {
  const params = {
    response_type: "code",
    client_id: String(formData.get("clientId") ?? ""),
    redirect_uri: String(formData.get("redirectUri") ?? ""),
    code_challenge: String(formData.get("codeChallenge") ?? ""),
    code_challenge_method: "S256",
    scope: String(formData.get("scope") ?? ""),
    state: formData.get("state") ? String(formData.get("state")) : undefined,
  };
  return validateAuthorizeRequest(params);
}

export async function denyAuthorization(formData: FormData) {
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = formData.get("state") ? String(formData.get("state")) : null;

  const client = await prisma.oAuthClient.findFirst({ where: { redirectUris: { has: redirectUri } } });
  if (!client) {
    redirect("/");
  }

  redirect(appendRedirectParams(redirectUri, { error: "access_denied", state }));
}

export async function approveAuthorization(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const result = await revalidate(formData);

  if (!result.ok && !result.redirectable) {
    redirect("/");
  }

  if (!result.ok && result.redirectable) {
    redirect(appendRedirectParams(result.redirectUri, { error: result.error, state: result.state }));
  }

  const scopes = parseRequestedScope(result.scope);
  const plaintextCode = generateAuthorizationCode();

  await prisma.oAuthAuthorizationCode.create({
    data: {
      hashedCode: hashOAuthSecret(plaintextCode),
      clientId: result.clientId,
      userId: session.user.id,
      orgId: session.user.orgId,
      redirectUri: result.redirectUri,
      codeChallenge: result.codeChallenge,
      codeChallengeMethod: "S256",
      scope: scopes.join(" "),
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    },
  });

  redirect(appendRedirectParams(result.redirectUri, { code: plaintextCode, state: result.state }));
}
