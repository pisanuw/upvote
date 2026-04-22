"use client";

import { useEffect, useState } from "react";
import { TopicClient } from "@/components/topic-client";

type TopicData = {
  title: string;
  description: string | null;
  requiresAuthForVoting: boolean;
  isLocked: boolean;
  comments: Array<{
    id: string;
    authorName: string;
    body: string;
    createdAt: string;
    score: number;
    myVote: number | null;
    attachments: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }>;
  }>;
};

export default function TopicPage({
  params,
}: {
  params: { code: string };
}) {
  const [topic, setTopic] = useState<TopicData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/t/${params.code}`, { cache: "no-store" });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.error || "Topic not found.");
        return;
      }

      setTopic(payload);
    }

    void load();
  }, [params.code]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</p>
      </main>
    );
  }

  if (!topic) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">Loading topic...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <TopicClient code={params.code} initial={topic} />
    </main>
  );
}
