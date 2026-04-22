import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { z } from "zod";

async function resolveAdminTopic(adminCode: string) {
  const topic = await prisma.topic.findUnique({
    where: { adminCode },
    include: {
      comments: {
        orderBy: { createdAt: "desc" },
        include: {
          votes: {
            include: {
              voterUser: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!topic) {
    return { error: Response.json({ error: "Topic not found." }, { status: 404 }) };
  }

  if (await deleteExpiredTopicIfNeeded(topic)) {
    return { error: Response.json({ error: "Topic expired." }, { status: 404 }) };
  }

  return { topic };
}

function canAccessAdmin(topic: { requiresAuthForVoting: boolean; adminOwnerUserId: string | null }, sessionUserId: string | undefined) {
  if (!topic.requiresAuthForVoting) {
    return true;
  }

  return !!sessionUserId && topic.adminOwnerUserId === sessionUserId;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ adminCode: string }> },
) {
  const { adminCode } = await context.params;
  const { topic, error } = await resolveAdminTopic(adminCode);

  if (error || !topic) {
    return error;
  }

  const session = await auth();
  if (!canAccessAdmin(topic, session?.user?.id)) {
    return Response.json(
      {
        error:
          "This admin panel requires signing in as the authenticated topic owner.",
      },
      { status: 403 },
    );
  }

  return Response.json({
    title: topic.title,
    description: topic.description,
    shortCode: topic.shortCode,
    isLocked: topic.isLocked,
    requiresAuthForVoting: topic.requiresAuthForVoting,
    lastActivityAt: topic.lastActivityAt,
    comments: topic.comments.map((comment: (typeof topic.comments)[number]) => ({
      id: comment.id,
      authorName: comment.authorName,
      body: comment.body,
      createdAt: comment.createdAt,
      score: comment.votes.reduce(
        (sum: number, vote: (typeof comment.votes)[number]) => sum + vote.value,
        0,
      ),
      votes:
        topic.requiresAuthForVoting
          ? comment.votes.map((vote: (typeof comment.votes)[number]) => ({
              value: vote.value,
              user: vote.voterUser
                ? {
                    id: vote.voterUser.id,
                    name: vote.voterUser.name,
                    email: vote.voterUser.email,
                  }
                : null,
            }))
          : [],
    })),
  });
}

const patchSchema = z.object({
  isLocked: z.boolean(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ adminCode: string }> },
) {
  const { adminCode } = await context.params;
  const { topic, error } = await resolveAdminTopic(adminCode);

  if (error || !topic) {
    return error;
  }

  const session = await auth();
  if (!canAccessAdmin(topic, session?.user?.id)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const payload = await request.json();
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updated = await prisma.topic.update({
    where: { id: topic.id },
    data: {
      isLocked: parsed.data.isLocked,
      lastActivityAt: new Date(),
    },
  });

  return Response.json({ isLocked: updated.isLocked });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ adminCode: string }> },
) {
  const { adminCode } = await context.params;
  const { topic, error } = await resolveAdminTopic(adminCode);

  if (error || !topic) {
    return error;
  }

  const session = await auth();
  if (!canAccessAdmin(topic, session?.user?.id)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  await prisma.topic.delete({ where: { id: topic.id } });
  return Response.json({ deleted: true });
}
