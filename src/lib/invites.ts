export const INVITE_EXPIRY_DAYS = 14;

export function getInviteExpiryDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + INVITE_EXPIRY_DAYS);
  return d;
}
