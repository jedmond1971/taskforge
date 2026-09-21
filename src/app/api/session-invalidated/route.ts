import { authUnchecked, signOut } from "@/lib/auth";

// Landing point for sessions killed by a sessionVersion bump (SECH-86). The
// stale JWT still looks "logged in" to Edge middleware, so we must clear the
// cookie before sending the user to /login or middleware would bounce them back.
export async function GET() {
  const session = await authUnchecked();

  // Only sign out a genuinely dead/absent session — a valid session hitting this
  // URL (e.g. via a cross-site link) must not be logged out.
  if (session?.user && !session.invalidated) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  await signOut({ redirectTo: "/login" });
  return new Response(null, { status: 302, headers: { Location: "/login" } });
}
