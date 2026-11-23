"use client";

import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { googleProviderId } from "@/lib/google-sign-in";
import { signInHref } from "@/lib/callback-url";
import { GoogleSignInButton, SIGN_IN_LINK_CLASS } from "@/components/google-sign-in-button";
import { EmailSignInForm } from "@/components/email-sign-in-form";
import { track } from "@/lib/analytics";

/** Starts Google sign-in from any Google button, counted as the app event sign_in_started. */
export function signInWithGoogle(callbackUrl: string) {
  track("sign_in_started", { method: "google" });
  void signIn(googleProviderId(), { callbackUrl });
}

/**
 * A compact sign-in box (the topic page's "Sign in to comment and vote"):
 * Google, and a link to the sign-in page's email form that returns here.
 */
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
      <GoogleSignInButton onClick={() => signInWithGoogle(callbackUrl)} />
      <Link href={signInHref(callbackUrl)} className={SIGN_IN_LINK_CLASS}>
        Email me a sign-in code
      </Link>
    </div>
  );
}

/** The sign-in page's options: Google, an "or" divider, then the email form. */
export function SignInOptions({ callbackUrl, hasPendingCode = false }: { callbackUrl: string; hasPendingCode?: boolean }) {
  return (
    <div>
      <GoogleSignInButton fullWidth onClick={() => signInWithGoogle(callbackUrl)} />
      <div className="my-6 flex items-center gap-3 text-sm text-slate-500">
        <span aria-hidden className="h-px flex-1 bg-slate-200" />
        or
        <span aria-hidden className="h-px flex-1 bg-slate-200" />
      </div>
      <EmailSignInForm callbackUrl={callbackUrl} hasPendingCode={hasPendingCode} />
    </div>
  );
}
