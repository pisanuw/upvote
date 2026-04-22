"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

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

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Admin: {data.title}</h1>
        {data.description ? <p className="mt-3 whitespace-pre-wrap text-slate-700">{data.description}</p> : null}
        <p className="mt-4 text-sm text-slate-600">
          Participation URL: <a className="text-teal-700 underline" href={`/t/${data.shortCode}`}>{`/t/${data.shortCode}`}</a>
        </p>
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
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{comment.authorName}</p>
              <span className="text-sm font-semibold text-slate-700">Score: {comment.score}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-slate-700">{comment.body}</p>

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
