"use client";

import { AdminClient } from "@/components/admin-client";
import Link from "next/link";
import { use, useEffect, useState } from "react";

type AdminData = {
  title: string;
  description: string | null;
  shortCode: string;
  isLocked: boolean;
  requiresAuthForVoting: boolean;
  comments: Array<{
    id: string;
    authorName: string;
    body: string;
    createdAt: string;
    score: number;
    votes: Array<{
      value: number;
      user: {
        id: string;
        name: string | null;
        email: string | null;
      } | null;
    }>;
  }>;
};

export default function AdminPage({
  params,
}: {
  params: Promise<{ adminCode: string }>;
}) {
  const { adminCode } = use(params);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/a/${adminCode}`, { cache: "no-store" });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.error || "Failed to load admin data.");
        return;
      }

      setData(payload);
    }

    void load();
  }, [adminCode]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          {error}
        </div>
        <p className="mt-4 text-sm text-slate-600">
          <Link className="text-teal-700 underline" href="/signin">
            Sign in
          </Link>{" "}
          if this topic requires authenticated admin access.
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
          Loading admin panel...
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <AdminClient adminCode={adminCode} initial={data} />
    </main>
  );
}
