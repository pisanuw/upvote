import { prisma } from "@/lib/prisma";
import { checkSuperadminSecret } from "@/lib/superadmin-auth";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ topicId: string }> },
) {
  const authError = checkSuperadminSecret(request);
  if (authError) return authError;

  const { topicId } = await context.params;

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    return Response.json({ error: "Topic not found." }, { status: 404 });
  }

  await prisma.topic.delete({ where: { id: topicId } });
  return Response.json({ deleted: true });
}
