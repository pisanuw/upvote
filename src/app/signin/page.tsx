import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center p-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
        <p className="mt-3 text-slate-700">
          Use the top-right actions on the homepage to sign in with Google or request a magic link.
        </p>
        <p className="mt-6 text-sm text-slate-600">
          <Link className="text-teal-700 underline" href="/">
            Back to topic creation
          </Link>
        </p>
      </section>
    </main>
  );
}
