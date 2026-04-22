"use client";

import { signIn, signOut } from "next-auth/react";

export function SignInPanel({ isSignedIn }: { isSignedIn: boolean }) {
  if (isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
      >
        Sign out
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => signIn("google")}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
      >
        Google sign-in
      </button>
      <button
        type="button"
        onClick={() => {
          const email = window.prompt("Enter your email for a magic link");
          if (!email) return;
          void signIn("email", { email, callbackUrl: "/" });
        }}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
      >
        Magic link
      </button>
    </div>
  );
}
