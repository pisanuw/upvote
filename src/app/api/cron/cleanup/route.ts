import { prisma } from "@/lib/prisma";

const MAX_IDLE_DAYS = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threshold = new Date(Date.now() - MAX_IDLE_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.topic.deleteMany({
    where: {
      lastActivityAt: {
        lt: threshold,
      },
    },
  });

  return Response.json({ deletedTopics: result.count, threshold: threshold.toISOString() });
}
