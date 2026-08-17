import { prisma } from "@/lib/prisma";

export async function recordDocPageView(userId: string, pageId: string) {
  await prisma.docPageView.upsert({
    where: { userId_pageId: { userId, pageId } },
    create: { userId, pageId },
    update: { viewedAt: new Date() },
  });
}
