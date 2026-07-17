"use client";

import { BookOpen, Loader2, LogOut, Plus, Swords, Users } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { CampaignSummary, SessionUser } from "@/lib/campaign-types";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";

type AuthMode = "login" | "register";

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
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      onAuthed(data.user);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-stone-800 bg-stone-950/60 p-6">
        <div className="mb-6 flex items-center gap-3">
          <Swords className="size-7 text-amber-500" />
          <div>
            <h1 className="font-serif text-xl font-semibold">Open Dungeon Master</h1>
            <p className="text-sm text-stone-400">Multiplayer 5e with an AI DM</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-stone-400">Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              minLength={3}
              maxLength={24}
              className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 outline-none focus:border-amber-600"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-stone-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : 1}
              maxLength={100}
              className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 outline-none focus:border-amber-600"
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2 font-medium text-amber-50 hover:bg-amber-600 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
          className="mt-4 w-full text-center text-sm text-stone-400 hover:text-stone-200"
        >
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
        </button>

        <div className="mt-6 border-t border-stone-800 pt-4 text-center">
          <a href="/solo" className="text-sm text-stone-500 hover:text-stone-300">
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
          <Swords className="size-7 text-amber-500" />
          <div>
            <h1 className="font-serif text-xl font-semibold">Open Dungeon Master</h1>
            <p className="text-sm text-stone-400">Signed in as {user.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/solo"
            className="flex items-center gap-1.5 rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-900"
          >
            <BookOpen className="size-4" /> Solo mode
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-900"
          >
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your campaigns</h2>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-amber-50 hover:bg-amber-600"
          >
            <Plus className="size-4" /> New campaign
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-stone-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-800 p-6 text-center text-sm text-stone-500">
            No campaigns yet. Create one, or join with an invite code below.
          </p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <a
                  href={`/campaigns/${campaign.id}`}
                  className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3 hover:border-stone-600"
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
        <h2 className="mb-3 text-lg font-medium">Join with an invite code</h2>
        <form onSubmit={join} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="e.g. K7WQ2MNP"
            required
            maxLength={12}
            className="w-44 rounded-md border border-stone-700 bg-stone-900 px-3 py-2 font-mono uppercase tracking-widest outline-none focus:border-amber-600"
          />
          <button
            type="submit"
            disabled={joining}
            className="rounded-md border border-stone-700 px-4 py-2 text-sm hover:bg-stone-900 disabled:opacity-60"
          >
            {joining ? "Joining..." : "Join"}
          </button>
        </form>
        {joinError ? <p className="mt-2 text-sm text-red-400">{joinError}</p> : null}
      </section>

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
