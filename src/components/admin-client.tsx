"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownContent } from "@/components/markdown-content";

type VoteView = {
  value: number;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

type AdminComment = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  score: number;
  votes: VoteView[];
};

type AdminData = {
  title: string;
  description: string | null;
  shortCode: string;
  isLocked: boolean;
  requiresAuthForVoting: boolean;
  comments: AdminComment[];
};

export function AdminClient({ adminCode, initial }: { adminCode: string; initial: AdminData }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const participantUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/t/${data.shortCode}`
      : `/t/${data.shortCode}`;

  async function copyParticipantUrl() {
    try {
      await navigator.clipboard.writeText(
        typeof window !== "undefined"
          ? `${window.location.origin}/t/${data.shortCode}`
          : `/t/${data.shortCode}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function toggleLock() {
    setWorking(true);
    setError(null);

    const res = await fetch(`/api/a/${adminCode}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isLocked: !data.isLocked }),
    });
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.error || "Failed to update lock.");
      setWorking(false);
      return;
    }

    setData((prev) => ({ ...prev, isLocked: payload.isLocked }));
    setWorking(false);
  }

  async function deleteTopic() {
    if (!window.confirm("Delete this topic and all comments? This cannot be undone.")) {
      return;
    }

    setWorking(true);
    setError(null);

    const res = await fetch(`/api/a/${adminCode}`, { method: "DELETE" });
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.error || "Failed to delete topic.");
      setWorking(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function deleteComment(commentId: string) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;

    const res = await fetch(`/api/a/${adminCode}/comments/${commentId}`, {
      method: "DELETE",
    });
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.error || "Failed to delete comment.");
      return;
    }

    setData((prev) => ({
      ...prev,
      comments: prev.comments.filter((c) => c.id !== commentId),
    }));
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Admin: {data.title}</h1>
        {data.description ? <MarkdownContent content={data.description} className="mt-3 text-slate-700" /> : null}

        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Participant link — share this with your audience
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3">
            <a
              href={`/t/${data.shortCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate font-mono text-sm font-semibold text-teal-800 underline-offset-2 hover:underline"
            >
              {participantUrl}
            </a>
            <button
              type="button"
              onClick={copyParticipantUrl}
              className="shrink-0 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <button
          onClick={toggleLock}
          disabled={working}
          className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
          type="button"
        >
          {data.isLocked ? "Unlock comments" : "Lock comments"}
        </button>

        <button
          onClick={deleteTopic}
          disabled={working}
          className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
          type="button"
        >
          Delete topic
        </button>
      </section>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Comments ({data.comments.length})</h2>
        {data.comments.map((comment) => (
          <article key={comment.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{comment.authorName}</p>
                <p className="text-xs text-slate-500">{new Date(comment.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700">Score: {comment.score}</span>
                <button
                  type="button"
                  onClick={() => deleteComment(comment.id)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Delete
                </button>
              </div>
            </div>
            <MarkdownContent content={comment.body} className="mt-3 text-slate-700" />

            {data.requiresAuthForVoting ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">Vote details</p>
                {comment.votes.length === 0 ? (
                  <p className="text-slate-600">No votes yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-slate-700">
                    {comment.votes.map((vote, index) => (
                      <li key={`${comment.id}-${index}`}>
                        {vote.value > 0 ? "Upvote" : "Downvote"} by {vote.user?.name || vote.user?.email || "Unknown user"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
