import { prisma } from "@/lib/prisma";
import { getAttachmentBucket, getSupabaseAdmin } from "@/lib/supabase-admin";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  const topic = await prisma.topic.findUnique({ where: { shortCode: code } });

  if (!topic) {
    return Response.json({ error: "Topic not found." }, { status: 404 });
  }

  if (await deleteExpiredTopicIfNeeded(topic)) {
    return Response.json({ error: "Topic expired." }, { status: 404 });
  }

  if (topic.isLocked) {
    return Response.json({ error: "Topic is locked." }, { status: 423 });
  }

  const formData = await request.formData();
  const authorName = String(formData.get("authorName") ?? "Anonymous").trim();
  const body = String(formData.get("body") ?? "").trim();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (!body || body.length < 1 || body.length > 4000) {
    return Response.json({ error: "Comment body is invalid." }, { status: 400 });
  }

  if (files.length > 5) {
    return Response.json({ error: "Maximum 5 files per comment." }, { status: 400 });
  }

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: `File '${file.name}' exceeds 2 MB limit.` },
        { status: 400 },
      );
    }
  }

  const comment = await prisma.comment.create({
    data: {
      topicId: topic.id,
      authorName: authorName || "Anonymous",
      body,
    },
    select: {
      id: true,
      authorName: true,
      body: true,
      createdAt: true,
    },
  });

  let createdAttachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> = [];

  if (files.length > 0) {
    const supabase = getSupabaseAdmin();
    const bucket = getAttachmentBucket();
    const uploadedPaths: string[] = [];

    try {
      const attachmentRows: Array<{
        commentId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        storageBucket: string;
        storagePath: string;
      }> = [];

      for (const file of files) {
        const objectName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectPath = `${topic.id}/${comment.id}/${crypto.randomUUID()}-${objectName}`;
        const arrayBuffer = await file.arrayBuffer();
        const mimeType = file.type || "application/octet-stream";

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(objectPath, arrayBuffer, {
            contentType: mimeType,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        uploadedPaths.push(objectPath);
        attachmentRows.push({
          commentId: comment.id,
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
          storageBucket: bucket,
          storagePath: objectPath,
        });
      }

      await prisma.attachment.createMany({ data: attachmentRows });

      createdAttachments = await prisma.attachment.findMany({
        where: { commentId: comment.id },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
        },
        orderBy: { createdAt: "asc" },
      });
    } catch {
      await prisma.comment.delete({ where: { id: comment.id } });

      if (uploadedPaths.length > 0) {
        await supabase.storage.from(bucket).remove(uploadedPaths);
      }

      return Response.json(
        { error: "Failed to store attachment files." },
        { status: 500 },
      );
    }
  }

  await prisma.topic.update({
    where: { id: topic.id },
    data: { lastActivityAt: new Date() },
  });

  return Response.json({
    id: comment.id,
    authorName: comment.authorName,
    body: comment.body,
    createdAt: comment.createdAt,
    score: 0,
    myVote: null,
    attachments: createdAttachments,
  });
}
