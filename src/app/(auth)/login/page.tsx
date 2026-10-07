import { LoginForm } from "./LoginForm";

// Server component so the sign-in card is in the initial HTML. Only same-origin paths are
// accepted as a callback (a leading "//" would be a protocol-relative open redirect).
function safeCallback(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage(props: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const { callbackUrl } = await props.searchParams;
  return <LoginForm callbackUrl={safeCallback(callbackUrl)} />;
}
