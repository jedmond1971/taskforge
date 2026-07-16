import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/validate-authorize-request";
import { parseRequestedScope, OAUTH_SCOPES } from "@/lib/oauth/scopes";
import { approveAuthorization, denyAuthorization } from "./actions";

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl">
      {accentLine}
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white text-center mb-4">{title}</h1>
      {children}
    </div>
  );
}

function asString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params: AuthorizeParams = {
    response_type: asString(searchParams.response_type),
    client_id: asString(searchParams.client_id),
    redirect_uri: asString(searchParams.redirect_uri),
    code_challenge: asString(searchParams.code_challenge),
    code_challenge_method: asString(searchParams.code_challenge_method),
    scope: asString(searchParams.scope),
    state: asString(searchParams.state),
  };

  const result = await validateAuthorizeRequest(params);

  if (!result.ok && !result.redirectable) {
    return (
      <Card title="Connection Request Invalid">
        <p className="text-zinc-500 dark:text-zinc-400 text-sm text-center">{result.message}</p>
      </Card>
    );
  }

  if (!result.ok && result.redirectable) {
    const url = new URL(result.redirectUri);
    url.searchParams.set("error", result.error);
    url.searchParams.set("error_description", result.errorDescription);
    if (result.state) url.searchParams.set("state", result.state);
    redirect(url.toString());
  }

  if (!result.ok) redirect("/");

  const session = await auth();
  if (!session?.user) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
    select: { name: true },
  });

  const scopes = parseRequestedScope(result.scope);

  return (
    <Card title="Connect to JedForge">
      <p className="text-zinc-500 dark:text-zinc-400 text-sm text-center mb-6">
        <strong className="text-zinc-700 dark:text-zinc-200">{result.clientName ?? "This application"}</strong>{" "}
        wants to access your <strong className="text-zinc-700 dark:text-zinc-200">{org?.name ?? "workspace"}</strong> organization as{" "}
        <strong className="text-zinc-700 dark:text-zinc-200">{session.user.email}</strong>.
      </p>

      <ul className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 mb-8 list-disc list-inside">
        {scopes.map((scope) => (
          <li key={scope}>{OAUTH_SCOPES[scope]}</li>
        ))}
      </ul>

      <div className="flex gap-3">
        <form action={denyAuthorization} className="flex-1">
          <input type="hidden" name="redirectUri" value={result.redirectUri} />
          <input type="hidden" name="state" value={result.state ?? ""} />
          <button
            type="submit"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Deny
          </button>
        </form>
        <form action={approveAuthorization} className="flex-1">
          <input type="hidden" name="clientId" value={result.clientId} />
          <input type="hidden" name="redirectUri" value={result.redirectUri} />
          <input type="hidden" name="codeChallenge" value={result.codeChallenge} />
          <input type="hidden" name="scope" value={scopes.join(" ")} />
          <input type="hidden" name="state" value={result.state ?? ""} />
          <button
            type="submit"
            className="w-full rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
          >
            Approve
          </button>
        </form>
      </div>
    </Card>
  );
}
