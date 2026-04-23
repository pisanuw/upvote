"use client";

import { useState } from "react";

type SuperComment = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  voteCount: number;
  attachmentCount: number;
};

type SuperTopic = {
  id: string;
  title: string;
  shortCode: string;
  adminCode: string;
  isLocked: boolean;
  requiresAuthForVoting: boolean;
  lastActivityAt: string;
  createdAt: string;
  commentCount: number;
  comments: SuperComment[];
};

export function SuperadminClient({
  initial,
  secret,
}: {
  initial: SuperTopic[];
  secret: string;
}) {
  const [topics, setTopics] = useState(initial);
  const [working, setWorking] = useState<string | null>(null);

  const headers = {
    "Content-Type": "application/json",
    "x-superadmin-secret": secret,
  };

  async function deleteTopic(topicId: string, title: string) {
    if (!window.confirm(`Delete topic "${title}" and all its comments? This cannot be undone.`)) return;
    setWorking(topicId);
    const res = await fetch(`/api/superadmin/topics/${topicId}`, { method: "DELETE", headers });
    if (res.ok) {
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete topic.");
    }
    setWorking(null);
  }

  async function deleteComment(topicId: string, commentId: string) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    setWorking(commentId);
    const res = await fetch(`/api/superadmin/comments/${commentId}`, { method: "DELETE", headers });
    if (res.ok) {
      setTopics((prev) =>
        prev.map((t) =>
          t.id === topicId
            ? { ...t, comments: t.comments.filter((c) => c.id !== commentId), commentCount: t.commentCount - 1 }
            : t,
        ),
      );
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete comment.");
    }
    setWorking(null);
  }

  if (topics.length === 0) {
    return <p className="text-slate-600">No topics yet.</p>;
  }

  return (
    <div className="space-y-6">
      {topics.map((topic) => (
        <section key={topic.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-slate-900">{topic.title}</h2>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>
                  <a className="text-teal-700 underline" href={`/t/${topic.shortCode}`} target="_blank">
                    /t/{topic.shortCode}
                  </a>
                </span>
                <span>{topic.commentCount} comment{topic.commentCount !== 1 ? "s" : ""}</span>
                {topic.isLocked ? <span className="font-semibold text-amber-700">Locked</span> : null}
                {topic.requiresAuthForVoting ? <span className="font-semibold text-blue-700">Auth voting</span> : null}
                <span>Created {new Date(topic.createdAt).toLocaleDateString()}</span>
                <span>Last active {new Date(topic.lastActivityAt).toLocaleDateString()}</span>
              </div>
            </div>
            <button
              onClick={() => deleteTopic(topic.id, topic.title)}
              disabled={working === topic.id}
              className="shrink-0 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
              type="button"
            >
              {working === topic.id ? "Deleting…" : "Delete topic"}
            </button>
          </div>

          {topic.comments.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {topic.comments.map((comment) => (
                <li key={comment.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{comment.authorName}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{comment.body}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {comment.voteCount} vote{comment.voteCount !== 1 ? "s" : ""}
                      {comment.attachmentCount > 0 ? ` · ${comment.attachmentCount} file${comment.attachmentCount !== 1 ? "s" : ""}` : ""}
                      {" · "}{new Date(comment.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteComment(topic.id, comment.id)}
                    disabled={working === comment.id}
                    className="shrink-0 rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    type="button"
                  >
                    {working === comment.id ? "…" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-sm text-slate-400">No comments.</p>
          )}
        </section>
      ))}
    </div>
  );
}
