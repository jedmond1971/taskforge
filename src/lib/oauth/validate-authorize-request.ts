import { prisma } from "@/lib/prisma";

export type AuthorizeParams = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
};

export type AuthorizeValidationResult =
  | {
      ok: true;
      clientId: string;
      clientName: string | null;
      redirectUri: string;
      codeChallenge: string;
      scope: string;
      state: string | null;
    }
  // client_id/redirect_uri themselves are untrusted — never redirect, show an error page.
  | { ok: false; redirectable: false; message: string }
  // redirect_uri is verified against the registered client — safe to bounce back with an error.
  | {
      ok: false;
      redirectable: true;
      redirectUri: string;
      state: string | null;
      error: string;
      errorDescription: string;
    };

export async function validateAuthorizeRequest(
  params: AuthorizeParams
): Promise<AuthorizeValidationResult> {
  const clientId = params.client_id;
  if (!clientId) {
    return { ok: false, redirectable: false, message: "Missing client_id." };
  }

  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) {
    return { ok: false, redirectable: false, message: "Unknown client_id." };
  }

  const redirectUri = params.redirect_uri;
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      redirectable: false,
      message: "redirect_uri is not registered for this client.",
    };
  }

  const state = params.state ?? null;

  if (params.response_type !== "code") {
    return {
      ok: false,
      redirectable: true,
      redirectUri,
      state,
      error: "unsupported_response_type",
      errorDescription: "Only response_type=code is supported.",
    };
  }

  if (!params.code_challenge) {
    return {
      ok: false,
      redirectable: true,
      redirectUri,
      state,
      error: "invalid_request",
      errorDescription: "code_challenge is required.",
    };
  }

  if (params.code_challenge_method !== "S256") {
    return {
      ok: false,
      redirectable: true,
      redirectUri,
      state,
      error: "invalid_request",
      errorDescription: "code_challenge_method must be S256.",
    };
  }

  return {
    ok: true,
    clientId: client.id,
    clientName: client.clientName,
    redirectUri,
    codeChallenge: params.code_challenge,
    scope: params.scope ?? "",
    state,
  };
}
