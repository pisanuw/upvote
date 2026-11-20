import { auth } from "@/auth";
import Link from "next/link";
import { NavBarClient } from "@/components/nav-bar-client";

export async function NavBar() {
  const session = await auth();

  const user = session?.user
    ? {
        id: session.user.id ?? "",
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null;

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-xl font-black text-slate-900 hover:text-orange-500 transition-colors">
          UpvoteMe
        </Link>
        <NavBarClient user={user} />
      </div>
    </nav>
  );
}
