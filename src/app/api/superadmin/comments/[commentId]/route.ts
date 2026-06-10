import { prisma } from "@/lib/prisma";
import { checkSuperadminSecret } from "@/lib/superadmin-auth";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const authError = checkSuperadminSecret(request);
  if (authError) return authError;

  const { commentId } = await context.params;

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) {
    return Response.json({ error: "Comment not found." }, { status: 404 });
  }

  await prisma.comment.delete({ where: { id: commentId } });
  return Response.json({ deleted: true });
}
