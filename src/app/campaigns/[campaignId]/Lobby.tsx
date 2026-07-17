"use client";

import { Check, Copy, Loader2, Play, Swords, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  if (!campaign || !me) {
    return null;
  }

  const myMember = members.find((member) => member.userId === me.id);
  const mySheet = sheets.find((sheet) => sheet.userId === me.id);
  const isOwner = campaign.ownerUserId === me.id;
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

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <header className="mb-6">
        <a href="/" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; All campaigns
        </a>
        <div className="mt-2 flex items-center gap-3">
          <Swords className="size-7 text-amber-500" />
          <div>
            <h1 className="font-serif text-2xl font-semibold">{campaign.title}</h1>
            <p className="text-sm text-stone-400">
              Waiting in the lobby · Level {campaign.startingLevel} start · {campaign.difficulty}
              {campaign.theme ? ` · ${campaign.theme}` : ""}
            </p>
          </div>
        </div>
        {campaign.description ? (
          <p className="mt-3 text-sm text-stone-300">{campaign.description}</p>
        ) : null}
      </header>

      <section className="mb-6 flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950/60 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Invite code</p>
          <p className="font-mono text-lg tracking-widest">{campaign.inviteCode}</p>
        </div>
        <button
          type="button"
          onClick={copyInvite}
          className="flex items-center gap-1.5 rounded-md border border-stone-700 px-3 py-1.5 text-sm hover:bg-stone-900"
        >
          {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </section>

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
                  <UserRound className="size-5 text-stone-500" />
                  <div>
                    <p className="font-medium">
                      {member.username}
                      {member.role === "owner" ? (
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
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    member.ready ? "bg-emerald-950 text-emerald-300" : "bg-stone-800 text-stone-400",
                  )}
                >
                  {member.ready ? "ready" : "not ready"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        {!mySheet ? (
          <a
            href={`/campaigns/${campaign.id}/character`}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2.5 font-medium text-amber-50 hover:bg-amber-600"
          >
            Create your character
          </a>
        ) : (
          <button
            type="button"
            onClick={toggleReady}
            disabled={busy}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 font-medium disabled:opacity-60",
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
            className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2.5 font-medium text-amber-50 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
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
      </section>
    </main>
  );
}
