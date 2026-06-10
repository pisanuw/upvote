import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAttachmentBucket, getSupabaseAdmin } from "@/lib/supabase-admin";
import { deleteExpiredTopicIfNeeded } from "@/lib/topic";
import { rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import nodemailer from "nodemailer";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function notifyTopicOwner(
  topicTitle: string,
  topicShortCode: string,
  authorName: string,
  commentBody: string,
) {
  if (
    !process.env.AUTH_SMTP_HOST ||
    !process.env.AUTH_SMTP_USER ||
    !process.env.AUTH_SMTP_PASS ||
    !process.env.AUTH_SMTP_FROM
  ) {
    return;
  }

  const transport = nodemailer.createTransport({
    host: process.env.AUTH_SMTP_HOST,
    port: Number(process.env.AUTH_SMTP_PORT ?? 587),
    auth: {
      user: process.env.AUTH_SMTP_USER,
      pass: process.env.AUTH_SMTP_PASS,
    },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const topicUrl = `${appUrl}/t/${topicShortCode}`;

  await transport.sendMail({
    from: process.env.AUTH_SMTP_FROM,
    to: process.env.AUTH_SMTP_FROM, // send to site owner
    subject: `New comment on "${topicTitle}"`,
    text: [
      `${authorName} commented on your topic "${topicTitle}":`,
      "",
      commentBody.slice(0, 500),
      commentBody.length > 500 ? "…" : "",
      "",
      `View it at: ${topicUrl}`,
    ].join("\n"),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  // Rate limit by IP: 10 comments per minute
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown";

  const { allowed } = rateLimit(`comment:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!allowed) {
    return Response.json({ error: "Too many comments. Please wait a moment." }, { status: 429 });
  }

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

  if (topic.requiresAuthForVoting) {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Sign in is required to comment on this topic." }, { status: 401 });
    }
  }

  const formData = await request.formData();
  const authorName = String(formData.get("authorName") ?? "Anonymous").trim();
  const body = String(formData.get("body") ?? "").trim();
  const parentIdRaw = formData.get("parentId");
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (!body || body.length < 1 || body.length > 4000) {
    return Response.json({ error: "Comment body is invalid." }, { status: 400 });
  }

  // Validate parentId if provided — must belong to the same topic
  let parentId: string | null = null;
  if (parentIdRaw && String(parentIdRaw).trim()) {
    const parentComment = await prisma.comment.findFirst({
      where: { id: String(parentIdRaw), topicId: topic.id },
    });
    if (!parentComment) {
      return Response.json({ error: "Parent comment not found." }, { status: 404 });
    }
    parentId = parentComment.id;
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
      parentId,
      authorName: authorName || "Anonymous",
      body,
    },
    select: {
      id: true,
      parentId: true,
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

  // Email notification — fire and forget, never fail the request
  if (topic.adminOwnerUserId) {
    notifyTopicOwner(
      topic.title,
      topic.shortCode,
      comment.authorName,
      comment.body,
    ).catch(() => {});
  }

  return Response.json({
    id: comment.id,
    parentId: comment.parentId,
    authorName: comment.authorName,
    body: comment.body,
    createdAt: comment.createdAt,
    score: 0,
    myVote: null,
    attachments: createdAttachments,
  });
}
