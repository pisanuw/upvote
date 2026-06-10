import { SignInPanel } from "@/components/signin-panel";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center p-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
        <div className="mt-6">
          <SignInPanel isSignedIn={false} />
        </div>
      </section>
    </main>
  );
}
