import { auth } from "@/auth";
import { createAnonVoterKey } from "@/lib/ids";
import { prisma } from "@/lib/prisma";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { cookies } from "next/headers";
import { z } from "zod";

const bodySchema = z.object({
  commentId: z.string().min(1),
  // 1 = upvote, -1 = downvote, 0 = remove vote (toggle off)
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const payload = await request.json();
  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json({ error: "Invalid vote payload." }, { status: 400 });
  }

  const topic = await prisma.topic.findUnique({ where: { shortCode: code } });
  if (!topic) {
    return Response.json({ error: "Topic not found." }, { status: 404 });
  }

  if (await deleteExpiredTopicIfNeeded(topic)) {
    return Response.json({ error: "Topic expired." }, { status: 404 });
  }

  const session = await auth();
  if (topic.requiresAuthForVoting && !session?.user?.id) {
    return Response.json(
      { error: "Sign in is required to vote in this topic." },
      { status: 401 },
    );
  }

  const comment = await prisma.comment.findFirst({
    where: { id: parsed.data.commentId, topicId: topic.id },
  });

  if (!comment) {
    return Response.json({ error: "Comment not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  let voterKey = session?.user?.id
    ? `user_${session.user.id}`
    : cookieStore.get("upvote_anon_id")?.value;

  if (!voterKey) {
    voterKey = createAnonVoterKey();
    cookieStore.set("upvote_anon_id", voterKey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const { value, commentId } = parsed.data;

  if (value === 0) {
    await prisma.vote.deleteMany({
      where: { commentId, voterKey },
    });
  } else {
    await prisma.vote.upsert({
      where: { commentId_voterKey: { commentId, voterKey } },
      update: { value, voterUserId: session?.user?.id ?? null },
      create: { commentId, voterKey, voterUserId: session?.user?.id ?? null, value },
    });
  }

  await prisma.topic.update({
    where: { id: topic.id },
    data: { lastActivityAt: new Date() },
  });

  const agg = await prisma.vote.aggregate({
    where: { commentId },
    _sum: { value: true },
  });

  const myVote =
    value === 0
      ? null
      : value;

  return Response.json({ score: agg._sum.value ?? 0, myVote });
}
