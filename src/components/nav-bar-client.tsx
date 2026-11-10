"use client";

import { signIn, signOut } from "next-auth/react";
import { googleProviderId } from "@/lib/google-sign-in";
import {
  COMPACT_BUTTON_CLASS,
  COMPACT_TEXT_CLASS,
  GoogleSignInButton,
  SIGN_IN_BUTTON_CLASS,
} from "@/components/google-sign-in-button";
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
      <GoogleSignInButton text="Sign in with Google" compact onClick={() => signIn(googleProviderId(), { callbackUrl })} />
      <button
        type="button"
        onClick={() => {
          const email = window.prompt("Enter your email for a magic link");
          if (!email) return;
          void signIn("email", { email, callbackUrl });
        }}
        className={`${SIGN_IN_BUTTON_CLASS} ${COMPACT_BUTTON_CLASS} gap-1.5`}
      >
        {/* Envelope icon */}
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="currentColor" aria-hidden>
          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
        </svg>
        <span className={COMPACT_TEXT_CLASS}>Magic link</span>
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
