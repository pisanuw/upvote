"use client";

import { signIn, signOut } from "next-auth/react";
import { googleProviderId } from "@/lib/google-sign-in";
import { GoogleSignInButton, SIGN_IN_BUTTON_CLASS } from "@/components/google-sign-in-button";

export function SignInPanel({
  isSignedIn,
  callbackUrl = "/",
}: {
  isSignedIn: boolean;
  callbackUrl?: string;
}) {
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
    <div className="flex flex-wrap gap-2">
      <GoogleSignInButton onClick={() => signIn(googleProviderId(), { callbackUrl })} />
      <button
        type="button"
        onClick={() => {
          const email = window.prompt("Enter your email for a magic link");
          if (!email) return;
          void signIn("email", { email, callbackUrl });
        }}
        className={SIGN_IN_BUTTON_CLASS}
      >
        Email me a sign-in link
      </button>
    </div>
  );
}
