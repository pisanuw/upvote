import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ code: string; commentId: string; attachmentId: string }>;
  },
) {
  const { code, commentId, attachmentId } = await context.params;

  const topic = await prisma.topic.findUnique({ where: { shortCode: code } });

  if (!topic) {
    return Response.json({ error: "Topic not found." }, { status: 404 });
  }

  if (await deleteExpiredTopicIfNeeded(topic)) {
    return Response.json({ error: "Topic expired." }, { status: 404 });
  }

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      commentId,
      comment: {
        topicId: topic.id,
      },
    },
  });

  if (!attachment) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(attachment.storageBucket)
    .createSignedUrl(attachment.storagePath, 60, {
      download: attachment.fileName,
    });

  if (error || !data?.signedUrl) {
    return Response.json({ error: "Failed to load attachment." }, { status: 500 });
  }

  return Response.redirect(data.signedUrl, 302);
}
