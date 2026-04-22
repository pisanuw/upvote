import { Topic } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_IDLE_DAYS = 30;

export function isExpiredByActivity(lastActivityAt: Date): boolean {
  const threshold = Date.now() - MAX_IDLE_DAYS * 24 * 60 * 60 * 1000;
  return lastActivityAt.getTime() < threshold;
}

export async function deleteExpiredTopicIfNeeded(topic: Topic): Promise<boolean> {
  if (!isExpiredByActivity(topic.lastActivityAt)) {
    return false;
  }

  await prisma.topic.delete({ where: { id: topic.id } });
  return true;
}
