"use client";

import { useState } from "react";

type CreateResponse = {
  participantUrl: string;
  adminUrl: string;
};

export function CreateTopicForm({ isSignedIn }: { isSignedIn: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiresAuthForVoting, setRequiresAuthForVoting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, requiresAuthForVoting }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create topic.");
        return;
      }

      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-800" htmlFor="title">
          Topic title
        </label>
        <input
          id="title"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-teal-500"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={3}
          maxLength={120}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-800" htmlFor="description">
          Description (optional)
        </label>
        <textarea
          id="description"
          className="min-h-28 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-teal-500"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={3000}
        />
        <p className="text-xs text-slate-400">Supports Markdown</p>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
        <input
          type="checkbox"
          checked={requiresAuthForVoting}
          onChange={(e) => setRequiresAuthForVoting(e.target.checked)}
          className="mt-1"
          disabled={!isSignedIn}
        />
        <span>
          Require authentication for voting (Google or magic link).
          {!isSignedIn ? " Sign in first to enable this option." : ""}
        </span>
      </label>

      <button
        type="submit"
        className="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white transition hover:bg-teal-600 disabled:opacity-60"
        disabled={loading}
      >
        {loading ? "Creating topic..." : "Create topic"}
      </button>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {result ? (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Topic ready. Save these links now:</p>
          <div>
            <p className="font-medium">Participation URL</p>
            <a className="break-all underline" href={result.participantUrl}>
              {result.participantUrl}
            </a>
          </div>
          <div>
            <p className="font-medium">Admin URL</p>
            <a className="break-all underline" href={result.adminUrl}>
              {result.adminUrl}
            </a>
          </div>
        </div>
      ) : null}
    </form>
  );
}
