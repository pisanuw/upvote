import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function resolveAdminAndComment(adminCode: string, commentId: string) {
  const topic = await prisma.topic.findUnique({ where: { adminCode } });
  if (!topic) return { error: Response.json({ error: "Topic not found." }, { status: 404 }) };

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, topicId: topic.id },
  });
  if (!comment) return { error: Response.json({ error: "Comment not found." }, { status: 404 }) };

  return { topic, comment };
}

function canAccessAdmin(
  topic: { requiresAuthForVoting: boolean; adminOwnerUserId: string | null },
  sessionUserId: string | undefined,
) {
  if (!topic.requiresAuthForVoting) return true;
  return !!sessionUserId && topic.adminOwnerUserId === sessionUserId;
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ adminCode: string; commentId: string }> },
) {
  const { adminCode, commentId } = await context.params;
  const { topic, comment, error } = await resolveAdminAndComment(adminCode, commentId);
  if (error || !topic || !comment) return error;

  const session = await auth();
  if (!canAccessAdmin(topic, session?.user?.id)) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id: commentId } });
  return Response.json({ deleted: true });
}
