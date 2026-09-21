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
