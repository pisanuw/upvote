import Link from "next/link";

/**
 * The not-found page, for unknown addresses and for notFound() in a page.
 * data-hw-not-found tells public/hw-loader.js not to load the analytics
 * script when this page is opened directly, so whatever address was typed is
 * not sent. The marker is read only on a full page load: reached by an in-app
 * move, after the script has loaded, this page is counted with the path
 * masked. A visit that starts here is not counted when it moves on in the app
 * either; a page loaded in full is.
 */
export default function NotFound() {
  return (
    <main data-hw-not-found="" className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <h1 className="text-3xl font-black text-slate-900">Page not found</h1>
      <p className="mt-3 max-w-xl text-slate-700">
        There is nothing at this address. If someone gave you a topic link, check that it was copied in full.
      </p>
      <p className="mt-6">
        <Link href="/" className="font-semibold text-orange-600 underline hover:text-orange-500">
          Go to the UpvoteMe home page
        </Link>
      </p>
    </main>
  );
}
