"use client";

import { signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

type UserInfo = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: UserInfo }) {
  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const [imgFailed, setImgFailed] = useState(false);

  if (user.image && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt={user.name ?? "avatar"}
        referrerPolicy="no-referrer"
        className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white ring-2 ring-white">
      {initials}
    </span>
  );
}

// ─── Profile edit inline form ─────────────────────────────────────────────────

function ProfileEdit({ initialName, onSave, onCancel }: {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save."); return; }
      onSave(data.name);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2 px-3 py-2">
      <p className="text-xs font-semibold text-slate-700">Username</p>
      <input
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-orange-400 focus:outline-none"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        required
        autoFocus
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Signed-in menu ───────────────────────────────────────────────────────────

function AccountMenu({ user }: { user: UserInfo }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.name ?? user.email ?? "Account");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setEditing(false); }}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        aria-label="Account menu"
      >
        <Avatar user={{ ...user, name: displayName }} />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* User info header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Avatar user={{ ...user, name: displayName }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
              {user.email && <p className="truncate text-xs text-slate-500">{user.email}</p>}
            </div>
          </div>

          {/* Edit profile */}
          {editing ? (
            <ProfileEdit
              initialName={displayName}
              onSave={(name) => { setDisplayName(name); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="currentColor" aria-hidden>
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit username
            </button>
          )}

          <div className="border-t border-slate-100" />

          {/* Sign out */}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-2 rounded-b-2xl px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 10H7m0 0l3-3m-3 3l3 3M3 5v10a2 2 0 002 2h4" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Signed-out buttons ────────────────────────────────────────────────────────

function SignInButtons({ callbackUrl }: { callbackUrl: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl })}
        className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        {/* Google "G" icon */}
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in
      </button>
      <button
        type="button"
        onClick={() => {
          const email = window.prompt("Enter your email for a magic link");
          if (!email) return;
          void signIn("email", { email, callbackUrl });
        }}
        className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        {/* Envelope icon */}
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="currentColor" aria-hidden>
          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
        </svg>
        Magic link
      </button>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function NavBarClient({
  user,
  callbackUrl,
}: {
  user: UserInfo | null;
  callbackUrl: string;
}) {
  return user ? (
    <AccountMenu user={user} />
  ) : (
    <SignInButtons callbackUrl={callbackUrl} />
  );
}
