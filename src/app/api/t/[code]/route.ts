import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { cookies } from "next/headers";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  const topic = await prisma.topic.findUnique({
    where: { shortCode: code },
    include: {
      comments: {
        orderBy: { createdAt: "desc" },
        include: {
          attachments: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
            },
          },
          votes: {
            select: { value: true, voterKey: true, voterUserId: true },
          },
        },
      },
    },
  });

  if (!topic) {
    return Response.json({ error: "Topic not found." }, { status: 404 });
  }

  if (await deleteExpiredTopicIfNeeded(topic)) {
    return Response.json({ error: "Topic expired." }, { status: 404 });
  }

  const session = await auth();
  const cookieStore = await cookies();
  const anonKey = cookieStore.get("upvote_anon_id")?.value;
  const currentUserId = session?.user?.id ?? null;

  const canSeeComments = !topic.requiresAuthForVoting || !!currentUserId;

  return Response.json({
    id: topic.id,
    title: topic.title,
    description: topic.description,
    requiresAuthForVoting: topic.requiresAuthForVoting,
    isLocked: topic.isLocked,
    isSignedIn: !!currentUserId,
    comments: canSeeComments ? topic.comments.map((comment: (typeof topic.comments)[number]) => {
      const score = comment.votes.reduce(
        (sum: number, vote: (typeof comment.votes)[number]) => sum + vote.value,
        0,
      );
      const myVote =
        comment.votes.find((vote: (typeof comment.votes)[number]) => {
          if (currentUserId) {
            return vote.voterUserId === currentUserId;
          }

          return anonKey ? vote.voterKey === anonKey : false;
        })
          ?.value ?? null;

      return {
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt,
        score,
        myVote,
        attachments: comment.attachments,
      };
    }) : [],
  });
}
