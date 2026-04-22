import { auth } from "@/auth";
import { createAnonVoterKey } from "@/lib/ids";
import { prisma } from "@/lib/prisma";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { cookies } from "next/headers";
import { z } from "zod";

const bodySchema = z.object({
  commentId: z.string().min(1),
  value: z.union([z.literal(1), z.literal(-1)]),
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
    where: {
      id: parsed.data.commentId,
      topicId: topic.id,
    },
  });

  if (!comment) {
    return Response.json({ error: "Comment not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  let voterKey = session?.user?.id ? `user_${session.user.id}` : cookieStore.get("upvote_anon_id")?.value;

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

  await prisma.vote.upsert({
    where: {
      commentId_voterKey: {
        commentId: parsed.data.commentId,
        voterKey,
      },
    },
    update: {
      value: parsed.data.value,
      voterUserId: session?.user?.id ?? null,
    },
    create: {
      commentId: parsed.data.commentId,
      voterKey,
      voterUserId: session?.user?.id ?? null,
      value: parsed.data.value,
    },
  });

  await prisma.topic.update({
    where: { id: topic.id },
    data: { lastActivityAt: new Date() },
  });

  const score = await prisma.vote.aggregate({
    where: { commentId: parsed.data.commentId },
    _sum: { value: true },
  });

  return Response.json({ score: score._sum.value ?? 0 });
}
