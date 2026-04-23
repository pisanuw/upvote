import { SuperadminClient } from "@/components/superadmin-client";
import { prisma } from "@/lib/prisma";

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  const { secret } = await searchParams;
  const expected = process.env.SUPERADMIN_SECRET;

  if (!expected || secret !== expected) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          Unauthorized. Provide the correct <code>?secret=</code> parameter.
        </p>
      </main>
    );
  }

  const topics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      comments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          authorName: true,
          body: true,
          createdAt: true,
          _count: { select: { votes: true, attachments: true } },
        },
      },
    },
  });

  const data = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    shortCode: topic.shortCode,
    adminCode: topic.adminCode,
    isLocked: topic.isLocked,
    requiresAuthForVoting: topic.requiresAuthForVoting,
    lastActivityAt: topic.lastActivityAt.toISOString(),
    createdAt: topic.createdAt.toISOString(),
    commentCount: topic.comments.length,
    comments: topic.comments.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      voteCount: c._count.votes,
      attachmentCount: c._count.attachments,
    })),
  }));

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-slate-500">Superadmin</p>
        <h1 className="text-3xl font-black text-slate-900">All Topics</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data.length} topic{data.length !== 1 ? "s" : ""} total
        </p>
      </header>
      <SuperadminClient initial={data} secret={secret} />
    </main>
  );
}
