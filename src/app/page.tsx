"use client";

import { BookOpen, Loader2, LogOut, Plus, Swords, Users } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { IconChip, PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import type { CampaignSummary, SessionUser } from "@/lib/campaign-types";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";
import AuthForm from "@/app/AuthForm";

export default function Home() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
    );
  }

  return user ? (
    <Dashboard user={user} onLogout={() => setUser(null)} />
  ) : (
    <AuthScreen onAuthed={setUser} />
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <PixelTile src={PIXEL_ICONS.story} size="size-16" />
          <div>
            <h1 className="text-balance font-serif text-3xl text-stone-100">
              Open Dungeon Master
            </h1>
            <p className="mt-2 text-pretty text-sm text-stone-500">
              Gather your party. An AI Dungeon Master runs the table; the dice
              are honest and the story is yours.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-stone-800 bg-stone-950/70 p-6">
          <AuthForm onAuthed={onAuthed} />
        </div>

        <div className="mt-6 text-center">
          <a href="/solo" className="text-sm text-stone-500 hover:text-amber-200">
            Or play the single-player narrator
          </a>
        </div>
      </div>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/campaigns");
      if (response.ok) {
        const data = await response.json();
        setCampaigns(data.campaigns ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode.trim().toUpperCase() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setJoinError(data.error || "Could not join.");
        return;
      }
      window.location.href = `/campaigns/${data.campaign.id}`;
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.story} />
          <div>
            <h1 className="font-serif text-xl text-stone-100">Open Dungeon Master</h1>
            <p className="text-sm text-stone-500">Signed in as {user.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/characters" className={ui.btnSmall}>
            <Users className="size-4" /> Characters
          </Link>
          <a href="/solo" className={ui.btnSmall}>
            <BookOpen className="size-4" /> Solo mode
          </a>
          <button type="button" onClick={logout} className={ui.btnSmall}>
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PixelTile src={PIXEL_ICONS.chats} size="size-9" />
            <h2 className="text-lg font-medium">Your campaigns</h2>
          </div>
          <button type="button" onClick={() => setCreateOpen(true)} className={ui.btnPrimary}>
            <Plus className="size-4" /> New campaign
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-stone-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-800 bg-stone-950/40 px-6 py-10 text-center">
            <IconChip icon={Swords} size="size-12" iconSize="size-5" />
            <div className="max-w-sm">
              <p className="text-balance font-serif text-2xl text-stone-200">
                Every campaign starts with an empty table.
              </p>
              <p className="mt-2 text-pretty text-sm text-stone-500">
                Create one and invite your friends, or join theirs with a room code below.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <a
                  href={`/campaigns/${campaign.id}`}
                  className={cn(ui.cardHover, "flex items-center justify-between px-4 py-3")}
                >
                  <div>
                    <p className="font-medium">{campaign.title}</p>
                    <p className="text-sm text-stone-400">
                      Level {campaign.startingLevel} start · {campaign.difficulty}
                      {campaign.theme ? ` · ${campaign.theme}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-stone-400">
                    <span className="flex items-center gap-1">
                      <Users className="size-4" />
                      {campaign.playerCount}/{campaign.maxPlayers}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        campaign.status === "lobby" && "bg-sky-950 text-sky-300",
                        campaign.status === "active" && "bg-emerald-950 text-emerald-300",
                        campaign.status === "ended" && "bg-stone-800 text-stone-400",
                      )}
                    >
                      {campaign.status}
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Join with a room code</h2>
        <form onSubmit={join} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="e.g. K7WQ2MNP"
            required
            maxLength={12}
            className="w-44 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 font-mono uppercase tracking-widest text-stone-200 outline-none focus:border-amber-300"
          />
          <button type="submit" disabled={joining} className={ui.btnSecondary}>
            {joining ? "Joining..." : "Join"}
          </button>
        </form>
        {joinError ? <p className="mt-2 text-sm text-red-400">{joinError}</p> : null}
      </section>

      <footer className="mt-12 border-t border-stone-900 pt-4 text-center">
        <a href="/licenses" className="text-xs text-stone-600 hover:text-stone-400">
          Licenses and attribution
        </a>
      </footer>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(campaignId) => {
          window.location.href = `/campaigns/${campaignId}`;
        }}
      />
    </main>
  );
}
