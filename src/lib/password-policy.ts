// Kept dependency-free so client forms can import it (password-reset.ts pulls in crypto, Resend and Prisma).
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only reads the first 72 bytes; a hard ceiling also bounds the work an unauthenticated caller can ask for.
export const PASSWORD_MAX_LENGTH = 128;
