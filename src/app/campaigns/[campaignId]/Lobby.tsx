"use client";

import Link from "next/link";
import {
  Check,
  Copy,
  Crown,
  Dices,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Play,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  if (!campaign || !me) {
    return null;
  }

  const myMember = members.find((member) => member.userId === me.id);
  const mySheet = sheets.find((sheet) => sheet.userId === me.id);
  const isOwner = campaign.ownerUserId === me.id;
  const isLead = campaign.leadUserId === me.id;
  const allReady = members.length > 0 && members.every((member) => member.ready);
  const allHaveSheets = members.every((member) =>
    sheets.some((sheet) => sheet.userId === member.userId),
  );

  async function toggleReady() {
    setBusy(true);
    setError("");
    try {
      await fetch(`/api/campaigns/${campaign!.id}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready: !myMember?.ready }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not start the campaign.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(campaign!.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/join/${campaign!.inviteCode}`,
    );
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  async function makeLead(userId: string) {
    await fetch(`/api/campaigns/${campaign!.id}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }

  async function toggleRealDice() {
    await fetch(`/api/campaigns/${campaign!.id}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useRealDice: !myMember?.useRealDice }),
    });
  }

  async function deleteCampaign() {
    if (
      !window.confirm(
        `Delete "${campaign!.title}" for everyone? All characters, messages, and story progress are lost. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not delete the campaign.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="mb-6">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; All campaigns
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.chats} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-serif text-2xl text-stone-100">
              <span className="truncate">{campaign.title}</span>
              {isLead ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Edit campaign settings"
                  className="rounded-md border border-stone-700 p-1.5 text-stone-400 hover:text-stone-200"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
            </h1>
            <p className="text-sm text-stone-500">
              Waiting in the lobby · Level {campaign.startingLevel} start · {campaign.difficulty}
              {campaign.theme ? ` · ${campaign.theme}` : ""}
            </p>
          </div>
        </div>
        {campaign.description ? (
          <p className="mt-3 text-sm text-stone-300">{campaign.description}</p>
        ) : null}
      </header>

      <section className="mb-6 rounded-xl border border-amber-200/15 bg-stone-950/70 px-4 py-3 shadow-[0_0_16px_rgba(251,191,36,0.06)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-amber-200/70">Room code</p>
            <p className="font-mono text-lg tracking-widest text-amber-100">
              {campaign.inviteCode}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copyInvite} className={ui.btnSmall}>
              {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Code"}
            </button>
            <button type="button" onClick={copyLink} className={ui.btnSmall}>
              {linkCopied ? (
                <Check className="size-4 text-emerald-400" />
              ) : (
                <LinkIcon className="size-4" />
              )}
              {linkCopied ? "Copied" : "Link"}
            </button>
          </div>
        </div>
        <p className="mt-1.5 break-all font-mono text-xs text-stone-500">
          {typeof window !== "undefined" ? `${window.location.origin}/join/${campaign.inviteCode}` : ""}
        </p>
      </section>

      <GameSettingsPanel
        campaignId={campaign.id}
        settings={campaign.gameSettings}
        isLead={isLead}
      />

      {campaign.gameSettings.dicePolicy === "real_allowed" && mySheet ? (
        <section className="mb-6 flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3">
          <div>
            <p className="text-sm text-stone-200">I roll physical dice</p>
            <p className="text-xs text-stone-500">
              The game pauses for you to enter your real rolls instead of rolling digitally.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleRealDice}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              myMember?.useRealDice
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400 hover:bg-stone-900",
            )}
          >
            <Dices className="mr-1.5 inline size-4" />
            {myMember?.useRealDice ? "Real dice" : "Digital"}
          </button>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">
          Party ({members.length}/{campaign.maxPlayers})
        </h2>
        <ul className="space-y-2">
          {members.map((member) => {
            const sheet = sheets.find((entry) => entry.userId === member.userId);
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {member.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatar.url}
                      alt=""
                      className="size-9 rounded-full border border-stone-700 object-cover"
                    />
                  ) : (
                    <span className="flex size-9 items-center justify-center rounded-full border border-stone-800 bg-stone-900">
                      <UserRound className="size-4 text-stone-500" />
                    </span>
                  )}
                  <div>
                    <p className="font-medium">
                      {member.username}
                      {member.userId === campaign.leadUserId ? (
                        <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                          <Crown className="mr-0.5 inline size-3" /> party lead
                        </span>
                      ) : member.role === "owner" ? (
                        <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                          owner
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-stone-400">
                      {sheet
                        ? `${sheet.name} · ${sheet.race.replaceAll("_", " ")} ${sheet.class} ${sheet.level}`
                        : "No character yet"}
                    </p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5">
                  {(isLead || isOwner) && member.userId !== campaign.leadUserId ? (
                    <button
                      type="button"
                      onClick={() => makeLead(member.userId)}
                      className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-900"
                      title="Hand the party lead to this player"
                    >
                      <Crown className="mr-0.5 inline size-3" /> make lead
                    </button>
                  ) : null}
                  {member.useRealDice ? (
                    <span
                      className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300"
                      title="Rolls physical dice"
                    >
                      real dice
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      member.ready ? "bg-emerald-950 text-emerald-300" : "bg-stone-800 text-stone-400",
                    )}
                  >
                    {member.ready ? "ready" : "not ready"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        {!mySheet ? (
          <Link href={`/campaigns/${campaign.id}/character`} className={cn(ui.btnPrimary, "w-full")}>
            Create your character
          </Link>
        ) : (
          <button
            type="button"
            onClick={toggleReady}
            disabled={busy}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-medium disabled:opacity-60",
              myMember?.ready
                ? "border border-stone-700 text-stone-300 hover:bg-stone-900"
                : "bg-emerald-700 text-emerald-50 hover:bg-emerald-600",
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {myMember?.ready ? "Un-ready" : "Ready up"}
          </button>
        )}

        {isOwner ? (
          <button
            type="button"
            onClick={start}
            disabled={busy || !allReady || !allHaveSheets}
            className={cn(ui.btnPrimary, "w-full py-2.5")}
          >
            <Play className="size-4" /> Begin the adventure
          </button>
        ) : (
          <p className="text-center text-sm text-stone-500">
            The owner starts the adventure once everyone is ready.
          </p>
        )}
        {isOwner && (!allReady || !allHaveSheets) ? (
          <p className="text-center text-sm text-stone-500">
            {!allHaveSheets
              ? "Everyone needs a character first."
              : "Waiting for everyone to ready up."}
          </p>
        ) : null}
        {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}

        {isOwner ? (
          <button
            type="button"
            onClick={deleteCampaign}
            disabled={busy}
            className="mx-auto flex items-center gap-1.5 pt-2 text-xs text-stone-600 hover:text-red-400 disabled:opacity-60"
          >
            <Trash2 className="size-3.5" /> Delete this campaign
          </button>
        ) : null}
      </section>

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}
    </main>
  );
}
