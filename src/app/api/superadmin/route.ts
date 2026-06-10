import { prisma } from "@/lib/prisma";
import { checkSuperadminSecret } from "@/lib/superadmin-auth";

export async function GET(request: Request) {
  const authError = checkSuperadminSecret(request);
  if (authError) return authError;

  const topics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      comments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          authorName: true,
          body: true,
          createdAt: true,
          _count: { select: { votes: true, attachments: true } },
        },
      },
    },
  });

  return Response.json(
    topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      shortCode: topic.shortCode,
      adminCode: topic.adminCode,
      isLocked: topic.isLocked,
      requiresAuthForVoting: topic.requiresAuthForVoting,
      lastActivityAt: topic.lastActivityAt,
      createdAt: topic.createdAt,
      commentCount: topic.comments.length,
      comments: topic.comments.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        body: c.body,
        createdAt: c.createdAt,
        voteCount: c._count.votes,
        attachmentCount: c._count.attachments,
      })),
    })),
  );
}
