import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { TopicClient } from "@/components/topic-client";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ root?: string }>;
}) {
  const { code } = await params;
  const { root: rootCommentId } = await searchParams;

  const topic = await prisma.topic.findUnique({
    where: { shortCode: code },
    include: {
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          attachments: {
            select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
          },
          votes: {
            select: { value: true, voterKey: true, voterUserId: true },
          },
        },
      },
    },
  });

  if (!topic) notFound();

  if (await deleteExpiredTopicIfNeeded(topic)) notFound();

  const session = await auth();
  const cookieStore = await cookies();
  const anonKey = cookieStore.get("upvote_anon_id")?.value;
  const currentUserId = session?.user?.id ?? null;
  const canSeeComments = !topic.requiresAuthForVoting || !!currentUserId;

  const data = {
    title: topic.title,
    description: topic.description,
    requiresAuthForVoting: topic.requiresAuthForVoting,
    isLocked: topic.isLocked,
    isSignedIn: !!currentUserId,
    lastActivityAt: topic.lastActivityAt.toISOString(),
    comments: canSeeComments
      ? topic.comments.map((comment) => {
          const score = comment.votes.reduce((sum, v) => sum + v.value, 0);
          const myVote =
            comment.votes.find((v) =>
              currentUserId
                ? v.voterUserId === currentUserId
                : anonKey
                  ? v.voterKey === anonKey
                  : false,
            )?.value ?? null;

          return {
            id: comment.id,
            parentId: comment.parentId,
            authorName: comment.authorName,
            body: comment.body,
            createdAt: comment.createdAt.toISOString(),
            score,
            myVote,
            attachments: comment.attachments,
          };
        })
      : [],
  };

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <TopicClient code={code} initial={data} rootCommentId={rootCommentId ?? null} />
    </main>
  );
}
