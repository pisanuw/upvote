"use client";

import { useMemo, useState } from "react";
import { SignInPanel } from "@/components/signin-panel";
import { MarkdownContent } from "@/components/markdown-content";

// ─── Types ────────────────────────────────────────────────────────────────────

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CommentData = {
  id: string;
  parentId: string | null;
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
  lastActivityAt: string;
  comments: CommentData[];
};

type SortOrder = "score" | "newest" | "oldest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 365) return `${days}d ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function daysUntilExpiry(lastActivityAt: string): number {
  const idle = (Date.now() - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(30 - idle));
}

function sortComments(list: CommentData[], order: SortOrder): CommentData[] {
  return [...list].sort((a, b) => {
    if (order === "score") return b.score - a.score;
    if (order === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UpArrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 4L4 14h16L12 4z" />
    </svg>
  );
}

function DownArrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 20l8-10H4l8 10z" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

// ─── Textarea with character counter ─────────────────────────────────────────

const CHAR_LIMIT = 4000;
const CHAR_WARN = 3500;

function BodyTextarea({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const remaining = CHAR_LIMIT - value.length;
  const warn = value.length >= CHAR_WARN;

  return (
    <div>
      <div className="relative">
        <textarea
          className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder={placeholder}
          required
          maxLength={CHAR_LIMIT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {warn && (
          <span className={`absolute bottom-2 right-2 text-xs tabular-nums ${remaining <= 100 ? "text-rose-500" : "text-amber-500"}`}>
            {remaining}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">Supports Markdown — **bold**, _italic_, [links](url), lists, `code`</p>
    </div>
  );
}

// ─── Reply form ───────────────────────────────────────────────────────────────

function ReplyForm({
  code,
  parentId,
  onSubmit,
  onCancel,
}: {
  code: string;
  parentId: string;
  onSubmit: (comment: CommentData) => void;
  onCancel: () => void;
}) {
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.set("authorName", authorName);
    fd.set("body", body);
    fd.set("parentId", parentId);

    try {
      const res = await fetch(`/api/t/${code}/comments`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to post reply."); return; }
      onSubmit(data);
      setBody("");
      setAuthorName("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={submit}>
      <input
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        placeholder="Name (optional)"
        maxLength={120}
        value={authorName}
        onChange={(e) => setAuthorName(e.target.value)}
      />
      <BodyTextarea value={body} onChange={setBody} placeholder="Write a reply…" />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? "Posting…" : "Reply"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Single comment node (recursive) ─────────────────────────────────────────

const MAX_DEPTH = 3;

function CommentNode({
  comment,
  depth,
  code,
  childrenMap,
  isLocked,
  canInteract,
  collapsed,
  onToggleCollapse,
  onVote,
  onNewComment,
}: {
  comment: CommentData;
  depth: number;
  code: string;
  childrenMap: Map<string | null, CommentData[]>;
  isLocked: boolean;
  canInteract: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onVote: (commentId: string, value: 1 | -1) => void;
  onNewComment: (comment: CommentData) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const children = childrenMap.get(comment.id) ?? [];
  const isCollapsed = collapsed.has(comment.id);

  function copyShareLink() {
    const url = `${window.location.origin}/t/${code}?root=${comment.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={depth > 0 ? "ml-4" : ""}>
      <div className="flex gap-2">
        {/* Collapse toggle — the indent line */}
        {depth > 0 && (
          <button
            type="button"
            onClick={() => onToggleCollapse(comment.id)}
            className="group mt-1 w-4 shrink-0 self-stretch"
            aria-label={isCollapsed ? "Expand thread" : "Collapse thread"}
          >
            <div className="mx-auto h-full w-0.5 rounded-full bg-slate-200 group-hover:bg-orange-400 transition-colors" />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <article className="py-2">
            {/* Header */}
            <div className="flex items-baseline gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-800">{comment.authorName}</span>
              <span title={fullDate(comment.createdAt)} className="cursor-default">
                {relativeTime(comment.createdAt)}
              </span>
              {isCollapsed && children.length > 0 && (
                <button
                  type="button"
                  onClick={() => onToggleCollapse(comment.id)}
                  className="text-teal-600 hover:underline"
                >
                  [{children.length} hidden]
                </button>
              )}
            </div>

            {/* Body — hidden when collapsed */}
            {!isCollapsed && (
              <>
                <MarkdownContent content={comment.body} className="mt-1 text-sm text-slate-800" />

                {comment.attachments.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {comment.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          className="text-teal-700 underline"
                          href={`/api/t/${code}/comments/${comment.id}/attachments/${a.id}`}
                        >
                          {a.fileName} ({Math.ceil(a.sizeBytes / 1024)} KB)
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Action bar */}
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => canInteract && onVote(comment.id, 1)}
                    className={`flex items-center transition ${comment.myVote === 1 ? "font-bold text-orange-500" : "hover:text-orange-500"} ${!canInteract ? "cursor-default opacity-50" : ""}`}
                    aria-label="Upvote"
                  >
                    <UpArrow />
                  </button>

                  <span className={`min-w-[1.5ch] text-center font-semibold tabular-nums ${
                    comment.myVote === 1 ? "text-orange-500" : comment.myVote === -1 ? "text-blue-500" : "text-slate-700"
                  }`}>
                    {comment.score}
                  </span>

                  <button
                    type="button"
                    onClick={() => canInteract && onVote(comment.id, -1)}
                    className={`flex items-center transition ${comment.myVote === -1 ? "font-bold text-blue-500" : "hover:text-blue-500"} ${!canInteract ? "cursor-default opacity-50" : ""}`}
                    aria-label="Downvote"
                  >
                    <DownArrow />
                  </button>

                  {!isLocked && canInteract && (
                    <button
                      type="button"
                      onClick={() => setReplying((v) => !v)}
                      className="flex items-center gap-1 hover:text-slate-900"
                    >
                      <BubbleIcon />
                      <span>Reply</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="flex items-center gap-1 hover:text-slate-900"
                    title="Copy link to this comment"
                  >
                    <ShareIcon />
                    <span>{copied ? "Copied!" : "Share"}</span>
                  </button>
                </div>

                {replying && (
                  <ReplyForm
                    code={code}
                    parentId={comment.id}
                    onSubmit={(newComment) => { onNewComment(newComment); setReplying(false); }}
                    onCancel={() => setReplying(false)}
                  />
                )}
              </>
            )}
          </article>

          {/* Children */}
          {!isCollapsed && children.length > 0 && (
            depth < MAX_DEPTH ? (
              children.map((child) => (
                <CommentNode
                  key={child.id}
                  comment={child}
                  depth={depth + 1}
                  code={code}
                  childrenMap={childrenMap}
                  isLocked={isLocked}
                  canInteract={canInteract}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  onVote={onVote}
                  onNewComment={onNewComment}
                />
              ))
            ) : (
              <div className="ml-4 py-1">
                <a href={`/t/${code}?root=${comment.id}`} className="text-xs font-medium text-teal-700 hover:underline">
                  Continue this thread →
                </a>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TopicClient({
  code,
  initial,
  rootCommentId,
}: {
  code: string;
  initial: TopicData;
  rootCommentId: string | null;
}) {
  const [topic] = useState(initial);
  const [comments, setComments] = useState<CommentData[]>(initial.comments);
  const [replying, setReplying] = useState(false);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("score");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Build children map
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, CommentData[]>();
    for (const c of comments) {
      const key = c.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    // Replies always sorted by score
    for (const [key, children] of map.entries()) {
      if (key !== null) {
        children.sort((a, b) => b.score - a.score);
      }
    }
    return map;
  }, [comments]);

  // Root comments use the selected sort order
  const rootComments = useMemo(() => {
    if (rootCommentId) {
      const root = comments.find((c) => c.id === rootCommentId);
      return root ? [root] : [];
    }
    const roots = childrenMap.get(null) ?? [];
    return sortComments(roots, sortOrder);
  }, [childrenMap, comments, rootCommentId, sortOrder]);

  function addComment(newComment: CommentData) {
    setComments((prev) => [...prev, newComment]);
  }

  // Optimistic voting
  async function vote(commentId: string, requestedValue: 1 | -1) {
    const existing = comments.find((c) => c.id === commentId);
    const effectiveValue: 0 | 1 | -1 = existing?.myVote === requestedValue ? 0 : requestedValue;

    // Optimistic update
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const prevVote = c.myVote ?? 0;
        const delta = effectiveValue - prevVote;
        return { ...c, score: c.score + delta, myVote: effectiveValue === 0 ? null : effectiveValue };
      }),
    );

    try {
      const res = await fetch(`/api/t/${code}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, value: effectiveValue }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to vote.");
        // Revert optimistic update
        setComments((prev) =>
          prev.map((c) => c.id === commentId ? { ...c, score: existing!.score, myVote: existing!.myVote } : c),
        );
        return;
      }

      // Reconcile with server score
      setComments((prev) =>
        prev.map((c) => c.id === commentId ? { ...c, score: data.score, myVote: data.myVote } : c),
      );
    } catch {
      setError("Network error.");
      setComments((prev) =>
        prev.map((c) => c.id === commentId ? { ...c, score: existing!.score, myVote: existing!.myVote } : c),
      );
    }
  }

  async function submitTopLevelComment(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.set("authorName", authorName);
    fd.set("body", body);
    if (files) {
      for (const file of Array.from(files)) fd.append("files", file);
    }

    try {
      const res = await fetch(`/api/t/${code}/comments`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to post comment."); return; }
      addComment(data);
      setBody("");
      setAuthorName("");
      setFiles(null);
      setReplying(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canInteract = !topic.requiresAuthForVoting || topic.isSignedIn;
  const daysLeft = daysUntilExpiry(topic.lastActivityAt);

  return (
    <div className="space-y-6">
      {/* Topic header */}
      <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{topic.title}</h1>
        {topic.description && (
          <MarkdownContent content={topic.description} className="mt-3 text-slate-700" />
        )}

        {/* Status row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* Expiry indicator */}
          <span className={`text-xs ${daysLeft <= 5 ? "font-semibold text-rose-600" : "text-slate-400"}`}
            title={`Last activity: ${fullDate(topic.lastActivityAt)}`}>
            {daysLeft <= 5
              ? `Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
              : `${daysLeft}d until auto-delete`}
          </span>

          {topic.requiresAuthForVoting && !topic.isSignedIn && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M8 1a3 3 0 00-3 3v1H4a1 1 0 00-1 1v7a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1h-1V4a3 3 0 00-3-3zm-1 4V4a1 1 0 112 0v1H7zm1 4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd"/>
              </svg>
              Sign-in required to vote
            </span>
          )}

          {!rootCommentId && (
            topic.isLocked ? (
              <span className="text-xs font-medium text-amber-700">Locked — comments disabled</span>
            ) : !canInteract ? (
              <span className="text-xs text-slate-400">Sign in to comment</span>
            ) : (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
              >
                <BubbleIcon />
                <span>Reply</span>
              </button>
            )
          )}
        </div>

        {/* Inline reply form */}
        {!rootCommentId && replying && canInteract && !topic.isLocked && (
          <form className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={submitTopLevelComment}>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Name (optional)"
              maxLength={120}
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
            <BodyTextarea value={body} onChange={setBody} placeholder="Share your idea…" />
            <input type="file" multiple onChange={(e) => setFiles(e.target.files)} className="block w-full text-xs" />
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                {loading ? "Posting…" : "Reply"}
              </button>
              <button type="button"
                onClick={() => { setReplying(false); setBody(""); setAuthorName(""); setFiles(null); }}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Thread mode banner */}
      {rootCommentId && (
        <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <span>Showing a thread.</span>
          <a href={`/t/${code}`} className="font-semibold underline">← Back to full discussion</a>
        </div>
      )}

      {/* Sign-in prompt when auth required */}
      {!rootCommentId && !canInteract && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
          <p className="mb-3 text-sm font-semibold">Sign in to comment and vote.</p>
          <SignInPanel isSignedIn={false} callbackUrl={`/t/${code}`} />
        </div>
      )}

      {error && <p className="text-sm text-rose-700">{error}</p>}

      {/* Comment tree */}
      {canInteract && (
        <section>
          {/* Sort controls — only for full view with comments */}
          {!rootCommentId && rootComments.length > 1 && (
            <div className="mb-3 flex items-center gap-1 text-xs text-slate-500">
              <span className="mr-1">Sort:</span>
              {(["score", "newest", "oldest"] as SortOrder[]).map((order) => (
                <button
                  key={order}
                  type="button"
                  onClick={() => setSortOrder(order)}
                  className={`rounded-full px-2.5 py-1 capitalize transition ${
                    sortOrder === order
                      ? "bg-slate-900 text-white"
                      : "hover:bg-slate-100 text-slate-600"
                  }`}
                >
                  {order}
                </button>
              ))}
            </div>
          )}

          {rootComments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
              No comments yet. Be first.
            </p>
          ) : (
            <div className="space-y-1">
              {rootComments.map((comment) => (
                <CommentNode
                  key={comment.id}
                  comment={comment}
                  depth={0}
                  code={code}
                  childrenMap={childrenMap}
                  isLocked={topic.isLocked}
                  canInteract={canInteract}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  onVote={vote}
                  onNewComment={addComment}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
