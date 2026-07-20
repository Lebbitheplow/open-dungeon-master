"use client";

import { Loader2, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { AdminSettingsPanel } from "@/app/admin/AdminSettingsPanel";
import { AdminUsersPanel } from "@/app/admin/AdminUsersPanel";

type Me = {
  id: string;
  username: string;
  isAdmin: boolean;
};

type Tab = "settings" | "users";

// Server control panel. The page only decides what to render; every admin
// API route re-checks the is_admin flag server-side.
export default function AdminPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("settings");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!me?.isAdmin) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <p className="rounded-lg border border-stone-800 p-6 text-center text-stone-400">
          Admins only.{" "}
          <Link href="/" className="text-amber-200 hover:text-amber-400">
            Back to campaigns
          </Link>
        </p>
      </main>
    );
  }

  const tabs: Array<[Tab, string, typeof Settings2]> = [
    ["settings", "Server settings", Settings2],
    ["users", "Users", Users],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-6">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; All campaigns
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.localData} />
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">Admin panel</h1>
            <p className="text-sm text-stone-500">Signed in as {me.username}</p>
          </div>
        </div>
      </header>

      <div className="mb-4 flex gap-2">
        {tabs.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
              tab === value
                ? "border-amber-500/50 bg-stone-800/70 text-amber-100"
                : "border-stone-700/60 bg-stone-900/50 text-stone-400 hover:text-stone-200",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "settings" ? <AdminSettingsPanel /> : <AdminUsersPanel meId={me.id} />}
    </main>
  );
}
