"use client";

import { Check, Link2, Loader2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";

type Me = {
  id: string;
  username: string;
  avatar: { url: string } | null;
  isAdmin?: boolean;
  discordLinked?: boolean;
  discordAvailable?: boolean;
};

// Account settings: today, the profile picture shown across campaigns.
export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  // Seeded from the Discord link redirect (?linked=1 / ?error=...).
  const [discordNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const query = new URLSearchParams(window.location.search);
    if (query.get("linked") === "1") return "Discord account linked.";
    if (query.get("error") === "discord_taken") {
      return "That Discord account is already linked to another user.";
    }
    return "";
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
    const query = new URLSearchParams(window.location.search);
    if (query.get("linked") || query.get("error")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
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
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
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
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
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

      <section className="texture-noise mt-4 rounded-xl border border-stone-700/50 bg-stone-950/60 p-5 shadow-elev-1">
        <h2 className="mb-3 text-sm font-medium text-stone-300">Password</h2>
        <ChangePasswordForm
          onChanged={() => {
            setPasswordChanged(true);
            setTimeout(() => setPasswordChanged(false), 2500);
          }}
        />
        {passwordChanged ? (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" /> Password changed. Other devices were signed out.
          </p>
        ) : null}
      </section>

      {me.discordAvailable || me.discordLinked ? (
        <section className="texture-noise mt-4 rounded-xl border border-stone-700/50 bg-stone-950/60 p-5 shadow-elev-1">
          <h2 className="mb-3 text-sm font-medium text-stone-300">Discord</h2>
          {me.discordLinked ? (
            <p className="text-sm text-stone-400">
              <Check className="mr-1 inline size-4 text-emerald-400" />
              Linked. You can sign in with Discord.
            </p>
          ) : (
            <a href="/api/auth/discord/start?link=1" className={ui.btnSmall}>
              <Link2 className="size-3.5" /> Link Discord account
            </a>
          )}
          {discordNotice ? <p className="mt-2 text-sm text-amber-300">{discordNotice}</p> : null}
        </section>
      ) : null}

      {me.isAdmin ? (
        <p className="mt-6 text-sm text-stone-500">
          <Link href="/admin" className="inline-flex items-center gap-1.5 text-amber-200 hover:text-amber-400">
            <ShieldCheck className="size-4" /> Open the admin panel
          </Link>
        </p>
      ) : null}

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
