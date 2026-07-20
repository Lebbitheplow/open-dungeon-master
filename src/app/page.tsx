"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  CircleHelp,
  Loader2,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Swords,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { IconChip, PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import type { CampaignSummary, SessionUser } from "@/lib/campaign-types";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import AuthForm from "@/app/AuthForm";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";

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

  if (user?.mustChangePassword) {
    return (
      <ForcedPasswordChange
        onChanged={() => setUser({ ...user, mustChangePassword: false })}
      />
    );
  }

  return user ? (
    <Dashboard user={user} onLogout={() => setUser(null)} />
  ) : (
    <AuthScreen onAuthed={setUser} />
  );
}

// Shown when a session belongs to an account flagged by an admin password
// reset; the server rejects campaign APIs until the password is changed.
function ForcedPasswordChange({ onChanged }: { onChanged: () => void }) {
  return (
    <main className="bg-starfield flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-up-slow">
        <div className="glass texture-noise rounded-xl p-6 shadow-elev-2">
          <h1 className="mb-1 font-display text-xl tracking-wide text-amber-50">
            Set a new password
          </h1>
          <p className="mb-4 text-sm text-stone-400">
            An admin reset your password. Enter the temporary password you were given and pick a
            new one.
          </p>
          <ChangePasswordForm submitLabel="Set new password" onChanged={onChanged} />
        </div>
      </div>
    </main>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  return (
    <main className="bg-starfield flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-up-slow">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <PixelTile src={PIXEL_ICONS.story} size="size-16" className="animate-twinkle" />
          <div>
            <h1 className="text-balance font-display text-3xl tracking-wide text-amber-50">
              Open Dungeon Master
            </h1>
            <p className="mt-2 text-pretty text-sm text-stone-400">
              Gather your party. An AI Dungeon Master runs the table; the dice
              are honest and the story is yours.
            </p>
          </div>
        </div>

        <div className="glass texture-noise rounded-xl p-6 shadow-elev-2">
          <AuthForm onAuthed={onAuthed} />
        </div>
      </div>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [soloOpen, setSoloOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  async function deleteCampaign(campaign: CampaignSummary) {
    if (
      !window.confirm(
        `Delete "${campaign.title}" for everyone? All characters, messages, and story progress are lost. This cannot be undone.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
    if (response.ok) {
      setCampaigns((current) => current.filter((entry) => entry.id !== campaign.id));
    }
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
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.story} />
          <div>
            <h1 className="font-display text-xl tracking-wide text-amber-50">
              Open Dungeon Master
            </h1>
            <p className="text-sm text-stone-500">Signed in as {user.username}</p>
          </div>
        </div>
        <DropdownMenu.Root>
          <Tooltip content="Account and app menu" side="bottom">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="rounded-full outline-none transition-shadow duration-150 hover:shadow-glow-gold focus-visible:shadow-glow-gold"
            >
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar.url}
                  alt=""
                  className="size-9 rounded-full border border-amber-500/40 object-cover"
                />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-full border border-stone-600/70 bg-stone-900">
                  <UserRound className="size-4 text-stone-400" />
                </span>
              )}
            </button>
          </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="min-w-44 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
            >
              <DropdownMenu.Item asChild>
                <Link
                  href="/characters"
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
                >
                  <Users className="size-4" /> Characters
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <Link
                  href="/settings"
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
                >
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenu.Item>
              {user.isAdmin ? (
                <DropdownMenu.Item asChild>
                  <Link
                    href="/admin"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
                  >
                    <ShieldCheck className="size-4" /> Admin panel
                  </Link>
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item
                onSelect={() => setHelpOpen(true)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
              >
                <CircleHelp className="size-4" /> Help
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />
              <DropdownMenu.Item
                onSelect={logout}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
              >
                <LogOut className="size-4" /> Log out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      <section className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PixelTile src={PIXEL_ICONS.chats} size="size-9" />
            <h2 className="eyebrow text-sm text-amber-200/90">Your campaigns</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSoloOpen(true)} className={ui.btnSecondary}>
              <BookOpen className="size-4" /> Solo adventure
            </button>
            <button type="button" onClick={() => setCreateOpen(true)} className={ui.btnPrimary}>
              <Plus className="size-4" /> New campaign
            </button>
          </div>
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
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <a
                  href={`/campaigns/${campaign.id}`}
                  className={cn(ui.cardHover, "group relative block h-full px-5 py-4")}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-display text-lg tracking-wide text-amber-50">
                      {campaign.title}
                    </p>
                    <span
                      className={cn(
                        "eyebrow shrink-0 rounded-full border px-2 py-0.5 text-[9px]",
                        campaign.status === "lobby" &&
                          "border-sky-500/40 bg-sky-950/60 text-sky-300",
                        campaign.status === "active" &&
                          "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
                        campaign.status === "ended" &&
                          "border-stone-600/50 bg-stone-900 text-stone-400",
                      )}
                    >
                      {campaign.status}
                    </span>
                  </div>
                  <p className="text-sm text-stone-400">
                    Level {campaign.startingLevel} start · {campaign.difficulty}
                    {campaign.theme ? ` · ${campaign.theme}` : ""}
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-stone-700/40 pt-2.5 text-sm text-stone-400">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-4 text-amber-300/70" />
                      {campaign.playerCount}/{campaign.maxPlayers}
                      {campaign.maxPlayers === 1 ? " · solo" : " adventurers"}
                    </span>
                    {campaign.role === "owner" ? (
                      <Tooltip content="Delete this campaign">
                        <button
                          type="button"
                          aria-label="Delete this campaign"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteCampaign(campaign);
                          }}
                          className="rounded-md p-1 text-stone-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(ui.card, "ornate p-5")}>
        <h2 className="eyebrow mb-1 text-sm text-amber-200/90">Join with a room code</h2>
        <p className="mb-3 text-sm text-stone-500">
          A friend running a table gives you an eight-letter sigil.
        </p>
        <form onSubmit={join} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="K7WQ2MNP"
            required
            maxLength={12}
            className={cn(ui.input, "w-52 font-mono uppercase tracking-[0.25em]")}
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
      <CreateCampaignDialog
        solo
        open={soloOpen}
        onOpenChange={setSoloOpen}
        onCreated={(campaignId) => {
          window.location.href = `/campaigns/${campaignId}`;
        }}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
