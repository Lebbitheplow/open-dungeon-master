"use client";

import { Loader2, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";

type Me = {
  id: string;
  username: string;
  avatar: { url: string } | null;
};

// Account settings: today, the profile picture shown across campaigns.
export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  async function setAvatar(avatar: { url: string } | null) {
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      if (response.ok && me) {
        setMe({ ...me, avatar });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <p className="rounded-lg border border-stone-800 p-6 text-center text-stone-400">
          <Link href="/" className="text-amber-200 hover:text-amber-400">
            Log in
          </Link>{" "}
          to manage your account.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="mb-6">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; All campaigns
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">Account settings</h1>
            <p className="text-sm text-stone-500">Signed in as {me.username}</p>
          </div>
        </div>
      </header>

      <section className="texture-noise rounded-xl border border-stone-700/50 bg-stone-950/60 p-5 shadow-elev-1">
        <h2 className="mb-3 text-sm font-medium text-stone-300">Profile picture</h2>
        <div className="flex items-center gap-5">
          {me.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatar.url}
              alt="Your avatar"
              className="size-24 rounded-full border-2 border-amber-500/40 object-cover shadow-glow-gold"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full border border-stone-700 bg-stone-900">
              <UserRound className="size-10 text-stone-600" />
            </div>
          )}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setCropping(true)}
              disabled={saving}
              className={ui.btnPrimary}
            >
              {me.avatar ? "Change picture" : "Add picture"}
            </button>
            {me.avatar ? (
              <button
                type="button"
                onClick={() => setAvatar(null)}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-red-400"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          Shown next to your name in lobbies and at the table. Character portraits are set on each
          character.
        </p>
      </section>

      {cropping ? (
        <AvatarCropDialog
          title="Profile picture"
          onUploaded={(image) => setAvatar({ url: image.url })}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </main>
  );
}
