import type { Session } from "next-auth";

export type TestUser = { id: string; name: string; email: string; role: string; orgId: string };

let current: Session | null = null;

export function actAs(user: TestUser) {
  current = { user: { ...user }, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
}

export function actAsNobody() {
  current = null;
}

export function currentSession() {
  return current;
}

// Client IP seen by Server Actions via next/headers (mocked in setup.ts). Route
// handlers take theirs from the Request's own x-forwarded-for instead.
let clientIp = "203.0.113.200";

export function setClientIp(ip: string) {
  clientIp = ip;
}

export function currentClientIp() {
  return clientIp;
}
