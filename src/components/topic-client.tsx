"use client";

import { useMemo, useState } from "react";
import { SignInPanel } from "@/components/signin-panel";

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CommentData = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  score: number;
  myVote: number | null;
  attachments: Attachment[];
};

type TopicData = {
  title: string;
  description: string | null;
  requiresAuthForVoting: boolean;
  isLocked: boolean;
  isSignedIn: boolean;
  comments: CommentData[];
};

export function TopicClient({ code, initial }: { code: string; initial: TopicData }) {
  const [topic, setTopic] = useState(initial);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sortedComments = useMemo(
    () => [...topic.comments].sort((a, b) => b.score - a.score),
    [topic.comments]
  );

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.set("authorName", authorName);
    formData.set("body", body);
    if (files) {
      for (const file of Array.from(files)) {
        formData.append("files", file);
      }
    }

    const res = await fetch(`/api/t/${code}/comments`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to post comment.");
      setLoading(false);
      return;
    }

    setTopic((prev) => ({ ...prev, comments: [data, ...prev.comments] }));
    setBody("");
    setFiles(null);
    setLoading(false);
  }

  async function vote(commentId: string, value: 1 | -1) {
    const res = await fetch(`/api/t/${code}/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, value }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to vote.");
      return;
    }

    setTopic((prev) => ({
      ...prev,
      comments: prev.comments.map((comment) =>
        comment.id === commentId ? { ...comment, score: data.score, myVote: value } : comment,
      ),
    }));
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{topic.title}</h1>
        {topic.description ? <p className="mt-3 whitespace-pre-wrap text-slate-700">{topic.description}</p> : null}
        <p className="mt-4 text-xs uppercase tracking-[0.16em] text-slate-500">
          {topic.requiresAuthForVoting ? "Sign-in required for voting" : "Open voting"}
        </p>
      </section>

      {topic.isLocked ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          This topic is currently locked by admin. New comments are disabled.
        </div>
      ) : topic.requiresAuthForVoting && !topic.isSignedIn ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
          <p className="mb-3 font-semibold">Sign in to add a comment.</p>
          <SignInPanel isSignedIn={false} callbackUrl={`/t/${code}`} />
        </div>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Add a comment</h2>
          <form className="mt-4 space-y-4" onSubmit={submitComment}>
            <input
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Name (optional, defaults to Anonymous)"
              maxLength={120}
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
            <textarea
              className="min-h-28 w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Share your idea"
              required
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="block w-full text-sm"
            />
            <button
              className="rounded-xl bg-slate-900 px-5 py-3 text-white hover:bg-slate-700 disabled:opacity-60"
              disabled={loading}
              type="submit"
            >
              {loading ? "Posting..." : "Post comment"}
            </button>
          </form>
        </section>
      )}

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {topic.requiresAuthForVoting && !topic.isSignedIn ? null : <section className="space-y-4">
        {sortedComments.map((comment) => (
          <article key={comment.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{comment.authorName}</p>
              <time className="text-xs text-slate-500">
                {new Date(comment.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-slate-700">{comment.body}</p>

            {comment.attachments.length > 0 ? (
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-medium text-slate-800">Attachments</p>
                <ul className="space-y-1">
                  {comment.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <a
                        className="text-teal-700 underline"
                        href={`/api/t/${code}/comments/${comment.id}/attachments/${attachment.id}`}
                      >
                        {attachment.fileName} ({Math.ceil(attachment.sizeBytes / 1024)} KB)
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
                onClick={() => vote(comment.id, 1)}
                type="button"
              >
                Upvote
              </button>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
                onClick={() => vote(comment.id, -1)}
                type="button"
              >
                Downvote
              </button>
              <span className="text-sm font-semibold text-slate-700">Score: {comment.score}</span>
            </div>
          </article>
        ))}

        {sortedComments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
            No comments yet. Be first.
          </p>
        ) : null}
      </section>}
    </div>
  );
}
