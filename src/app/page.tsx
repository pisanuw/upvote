import { auth } from "@/auth";
import { CreateTopicForm } from "@/components/create-topic-form";
import { SignInPanel } from "@/components/signin-panel";

export default async function Home() {
  const session = await auth();

  return (
    <main className="relative mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-600">Private Collaboration</p>
          <h1 className="text-4xl font-black text-slate-900 sm:text-5xl">UpvoteMe</h1>
          <p className="mt-3 max-w-xl text-slate-700">
            Create an unlisted topic, share the short participation URL, and gather comments with upvotes or downvotes.
          </p>
        </div>
        <SignInPanel isSignedIn={!!session?.user?.id} />
      </header>

      <section className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">Create a topic</h2>
          <p className="mt-2 text-sm text-slate-700">
            Public listing is disabled by design. Anyone with the URL can participate.
          </p>
          <div className="mt-5">
            <CreateTopicForm isSignedIn={!!session?.user?.id} />
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">How it works</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li>1. Create a topic and copy both generated URLs.</li>
            <li>2. Share the participation URL with collaborators.</li>
            <li>3. Keep the admin URL private to manage the topic.</li>
            <li>4. Topics auto-delete after 30 days of inactivity.</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
