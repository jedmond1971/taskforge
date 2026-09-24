import { PrismaClient } from "@prisma/client";
import { securityEvent } from "@/lib/security-events";
import { summarizeError } from "@/lib/redaction";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * SECH-115: Prisma's own logger prints the full `data:` object of a failed write, and it
 * fires even when the caller catches — measured against a production build. Event-based
 * logging keeps the diagnostic without the payload: `$on("error")` still receives
 * validation errors, carrying the operation name, and nothing goes to stdout.
 *
 * Development deliberately keeps the noisy stdout config: the full payload is exactly
 * what you want when you are already debugging.
 */
function createPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    return new PrismaClient({ log: ["query", "error", "warn"] });
  }

  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }] });
  client.$on("error" as never, (event: { message?: string; target?: string }) => {
    const summary = summarizeError(
      Object.assign(new Error(event.message ?? ""), { name: "PrismaClientError" })
    );
    securityEvent("prisma.error", {
      meta: { ...summary, target: event.target ?? summary.target },
    });
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
