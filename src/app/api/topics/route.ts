import { auth } from "@/auth";
import { createAdminCode, createShareCode } from "@/lib/ids";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const bodySchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(3000).optional().or(z.literal("")),
  requiresAuthForVoting: z.boolean().default(false),
});

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const session = await auth();

  if (parsed.data.requiresAuthForVoting && !session?.user?.id) {
    return Response.json(
      {
        error:
          "You must be signed in before creating an auth-required topic.",
      },
      { status: 401 },
    );
  }

  const topic = await prisma.topic.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      shortCode: createShareCode(),
      adminCode: createAdminCode(),
      requiresAuthForVoting: parsed.data.requiresAuthForVoting,
      adminOwnerUserId: session?.user?.id ?? null,
    },
  });

  return Response.json({
    participantUrl: `/t/${topic.shortCode}`,
    adminUrl: `/a/${topic.adminCode}`,
    topic: {
      title: topic.title,
      requiresAuthForVoting: topic.requiresAuthForVoting,
    },
  });
}
