import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { SignInOptions, SignInPanel } from "@/components/signin-panel";
import { safeCallbackUrl } from "@/lib/callback-url";
import { signInErrorMessage } from "@/lib/sign-in-errors";

export const metadata: Metadata = {
  title: "Sign in · UpvoteMe",
  robots: { index: false, follow: false },
};

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const callbackUrl = safeCallbackUrl(first(query.callbackUrl));
  const error = signInErrorMessage(first(query.error));
  const session = await auth();
  const user = session?.user;

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-8 sm:p-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {user ? (
          <>
            <h1 className="text-3xl font-bold text-slate-900">You are signed in</h1>
            <p className="mt-3 text-slate-700">
              Signed in as <strong className="break-all text-slate-900">{user.name || user.email || "you"}</strong>
              {user.name && user.email ? <span className="break-all"> ({user.email})</span> : null}.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={callbackUrl}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white! hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
              >
                {callbackUrl === "/" ? "Go to the home page" : "Continue"}
              </Link>
              <SignInPanel isSignedIn />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
            <p className="mt-2 text-sm text-slate-600">
              Use your Google account, or get a one-time sign-in link by email. No password needed.
            </p>
            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {error}
              </p>
            )}
            <div className="mt-6">
              <SignInOptions callbackUrl={callbackUrl} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
