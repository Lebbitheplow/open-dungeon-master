"use client";

import Link from "next/link";
import {
  Bot,
  Check,
  Copy,
  Crown,
  Dices,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Play,
  QrCode,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { useShellShare } from "@/lib/use-shell-share";
import { InviteShareDialog } from "@/components/InviteShareDialog";
import { ScheduleSection } from "@/components/ScheduleSection";
import { Tooltip } from "@/components/ui/Tooltip";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { CompanionBuilderDialog } from "@/app/campaigns/[campaignId]/CompanionBuilderDialog";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { resolveCompanionMode } from "@/lib/schemas/game-settings";
import { viewerCaps } from "@/lib/dm/viewer";
import {
  ContentImportPicker,
  EMPTY_SELECTION,
  type ImportSelection,
} from "@/app/workshop/ContentImportPicker";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [buildingCompanion, setBuildingCompanion] = useState(false);
  const [contentImport, setContentImport] = useState<ImportSelection>(EMPTY_SELECTION);
  const [error, setError] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");
  const [canAssignSeats, setCanAssignSeats] = useState(false);
  // Bumped after a seat move so the canAssign answer is re-asked: handing the
  // DM seat away can revoke the mover's own right to move it again.
  const [seatVersion, setSeatVersion] = useState(0);
  const [seatError, setSeatError] = useState("");

  // Inside the desktop or Android app, on the app's own world, opening a
  // lobby is what puts the world on the internet: a campaign with a lobby
  // is one other people are meant to join. Elsewhere this is inert.
  const share = useShellShare(true);
  const shareUrl = share.status?.url ?? "";

  // Same reason as InviteShareDialog: a host sharing their world through a
  // tunnel plays on 127.0.0.1, an address guests cannot reach, so links
  // prefer the server's publicUrl, re-read whenever the tunnel comes or goes.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => response.json())
      .then((data: { publicUrl?: string }) => {
        if (!cancelled && typeof data.publicUrl === "string") {
          setPublicOrigin(data.publicUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  // Whether this viewer may move the DM seats is the seat route's call
  // (primary DM or owner), asked of the server rather than re-derived from
  // ids here, so a button it would refuse is never rendered.
  const seatCampaignId =
    campaign && campaign.gameSettings.dmMode !== "ai" ? campaign.id : "";
  useEffect(() => {
    // No reset on the way out: the buttons are also gated on the campaign
    // being human-run, so a stale yes renders nothing.
    if (!seatCampaignId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${seatCampaignId}/dm/seat`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { canAssign?: boolean } | null) => {
        if (!cancelled && data) {
          setCanAssignSeats(Boolean(data.canAssign));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seatCampaignId, seatVersion]);

  if (!campaign || !me) {
    return null;
  }

  const myMember = members.find((member) => member.userId === me.id);
  const mySheet = sheets.find((sheet) => sheet.userId === me.id);
  // The DM runs no character, so every "create your character" prompt below
  // has to know that. The seat is on the campaign row; the mode alone is not
  // enough, because an assisted campaign can still be AI-narrated.
  const isDm = campaign
    ? me.id === campaign.dmUserId || me.id === campaign.assistantDmUserId
    : false;
  const isOwner = campaign.ownerUserId === me.id;
  const isLead = campaign.leadUserId === me.id;
  // A human sits in the DM seat ("human" and "assisted" alike), so the party
  // list shows who holds it and, for whoever may reassign it, the controls.
  const humanDmTable = campaign.gameSettings.dmMode !== "ai";
  // Who holds the story's secrets and steers it: the lead in an AI-run
  // campaign, the DM once a person runs it. Decided by src/lib/dm/viewer.ts
  // rather than by comparing ids here, which is the rule that module exists
  // to enforce.
  const { steersStory } = viewerCaps(
    {
      ownerUserId: campaign.ownerUserId,
      leadUserId: campaign.leadUserId,
      humanDmUserId: campaign.dmUserId,
      assistantDmUserId: campaign.assistantDmUserId,
      dmMode: campaign.gameSettings.dmMode,
    },
    me.id,
  );
  // One-player campaigns skip the invite/party ceremony entirely.
  const isSolo = campaign.maxPlayers === 1;

  // Lead/solo can prepare lasting party companions here. Only party companions
  // are built manually, so the option shows only where they are allowed.
  const companions = sheets.filter((sheet) => sheet.isCompanion);
  const partyCompanions = companions.filter((sheet) => sheet.companionKind !== "guest");
  const canBuildCompanion =
    isLead &&
    resolveCompanionMode(campaign.gameSettings, members.length) === "full" &&
    partyCompanions.length < campaign.gameSettings.maxCompanions;
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

  // Solo flow: one button readies up and starts in a single stroke.
  async function beginSolo() {
    setBusy(true);
    setError("");
    try {
      if (!myMember?.ready) {
        await fetch(`/api/campaigns/${campaign!.id}/ready`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ready: true }),
        });
      }
      const response = await fetch(`/api/campaigns/${campaign!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not start the adventure.");
        return;
      }
      refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (await copyText(campaign!.inviteCode)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  // The copied link is the /j interstitial: it works whether the recipient
  // has the app or only a browser. The readable /join form stays on screen.
  const shareLinks = buildShareLinks({ publicOrigin, inviteCode: campaign.inviteCode });

  async function copyLink() {
    if (await copyText(shareLinks.appUrl)) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    }
  }

  async function makeLead(userId: string) {
    await fetch(`/api/campaigns/${campaign!.id}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }

  // Moves a DM seat; userId null empties it (the server allows that only for
  // the co-DM seat, since a human-run game always needs a DM). The seat
  // change event is not one the stream applies, so the mover reloads the
  // snapshot to see the new seats.
  async function assignSeat(seat: "dm" | "assistant", userId: string | null) {
    setSeatError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/dm/seat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seat, userId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSeatError(data.error || "Could not move that seat.");
        return;
      }
      setSeatVersion((version) => version + 1);
      refresh();
    } catch {
      setSeatError("Could not reach the server.");
    }
  }

  async function toggleRealDice() {
    await fetch(`/api/campaigns/${campaign!.id}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useRealDice: !myMember?.useRealDice }),
    });
  }

  // Lobby-only: drop your character so you can create or pick another. The
  // sheet_deleted stream event flips the UI back to "Create your character".
  async function removeCharacter() {
    if (
      !window.confirm(
        `Remove ${mySheet?.name ?? "your character"} from this campaign? You can create or pick another afterwards.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/sheet`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not remove the character.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // Lead removes a prepared companion (same path the in-session dismiss uses).
  async function dismissCompanion(characterId: string) {
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaign!.id}/companions/${characterId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not remove the companion.");
      }
    } catch {
      setError("Could not reach the server.");
    }
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
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <header className="bg-starfield mb-6 -mx-6 -mt-6 px-6 pb-5 pt-6">
        <Link href="/" className="text-sm text-stone-500 transition-colors hover:text-stone-300">
          &larr; All campaigns
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.chats} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-2xl tracking-wide text-amber-50">
              <span className="truncate">{campaign.title}</span>
              {isLead ? (
                <Tooltip content="Edit campaign settings">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit campaign settings"
                    className="rounded-md border border-stone-700 p-1.5 text-stone-400 hover:text-stone-200"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tooltip>
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

      {!isSolo ? (
      <section className="panel ornate mb-6 rounded-xl border-amber-400/30 px-5 py-4 shadow-glow-gold">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow text-[10px] text-amber-200/70">Room code</p>
            <p className="font-mono text-xl tracking-[0.3em] text-amber-100">
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
            <button type="button" onClick={() => setSharing(true)} className={ui.btnSmall}>
              <QrCode className="size-4" /> Share
            </button>
          </div>
        </div>
        <p className="mt-1.5 break-all font-mono text-xs text-stone-500">
          {shareLinks.joinUrl}
        </p>
      </section>
      ) : null}

      <GameSettingsPanel
        campaignId={campaign.id}
        settings={campaign.gameSettings}
        steersStory={isLead}
      />

      <section className="mb-6 space-y-3">
        <RulesPanel campaignId={campaign.id} settings={campaign.gameSettings} steersStory={isLead} />
        <LorePanel campaignId={campaign.id} steersStory={isLead} />
        {/* Prep keeps happening after session one, so the import is not only
            a creation-time step. Gated on story authority rather than on the
            lead, because in a human-DM campaign the lead is a player and the
            lore, places and prepared fights are the DM's to bring in. */}
        {steersStory ? (
          <div className={`${ui.card} p-3`}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
              Bring in prep
            </h2>
            <ContentImportPicker
              campaignId={campaign.id}
              selection={contentImport}
              onChange={setContentImport}
              onImported={refresh}
            />
          </div>
        ) : null}
      </section>

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

      {/* The call is open in the lobby, so the table can talk while people
          are still building characters. Pointless in a solo campaign, which
          is the same reason the party list is hidden there. */}
      {!isSolo ? (
        <section className="mb-6">
          {/* No floor to show in the lobby: the game has not started, so
              everyone can talk. */}
          <VoicePanel
            campaignId={campaign.id}
            meUserId={me.id}
            roster={state.voiceRoster}
            speaking={state.voiceSpeaking}
            audibilityVersion={state.voiceAudibilityVersion}
            meshSignal={state.voiceMeshSignal}
            adjudicates={steersStory}
          />
        </section>
      ) : null}

      {/* When the humans actually meet. Solo campaigns schedule nothing. */}
      {!isSolo ? (
        <ScheduleSection
          campaignId={campaign.id}
          meUserId={me.id}
          isLead={isLead}
          usernames={Object.fromEntries(members.map((member) => [member.userId, member.username]))}
          version={state.scheduleVersion}
        />
      ) : null}

      {!isSolo ? (
      <section className="mb-6">
        <h2 className="eyebrow mb-3 text-sm text-amber-200/90">
          Party · {members.length}/{campaign.maxPlayers}
        </h2>
        <ul className="space-y-2">
          {members.map((member) => {
            const sheet = sheets.find((entry) => entry.userId === member.userId);
            return (
              <li
                key={member.userId}
                className="panel flex items-center justify-between rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {member.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatar.url}
                      alt=""
                      className="size-12 rounded-full border border-amber-500/30 object-cover"
                    />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-full border border-stone-700/60 bg-stone-900">
                      <UserRound className="size-5 text-stone-500" />
                    </span>
                  )}
                  <div>
                    <p className="font-medium">
                      {member.username}
                      {humanDmTable && member.userId === campaign.dmUserId ? (
                        <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                          DM
                        </span>
                      ) : null}
                      {humanDmTable && member.userId === campaign.assistantDmUserId ? (
                        <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                          co-DM
                        </span>
                      ) : null}
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
                    <Tooltip content="Hand the party lead to this player">
                      <button
                        type="button"
                        onClick={() => makeLead(member.userId)}
                        className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-900"
                      >
                        <Crown className="mr-0.5 inline size-3" /> make lead
                      </button>
                    </Tooltip>
                  ) : null}
                  {humanDmTable && canAssignSeats && member.userId !== campaign.dmUserId ? (
                    <>
                      <Tooltip content="Hand this player the DM seat and the game">
                        <button
                          type="button"
                          onClick={() => assignSeat("dm", member.userId)}
                          className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-900"
                        >
                          make DM
                        </button>
                      </Tooltip>
                      {member.userId === campaign.assistantDmUserId ? (
                        <Tooltip content="Take back the co-DM seat">
                          <button
                            type="button"
                            onClick={() => assignSeat("assistant", null)}
                            className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-900"
                          >
                            remove co-DM
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip content="Seat this player as co-DM: every DM power except handing out seats">
                          <button
                            type="button"
                            onClick={() => assignSeat("assistant", member.userId)}
                            className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:bg-stone-900"
                          >
                            make co-DM
                          </button>
                        </Tooltip>
                      )}
                    </>
                  ) : null}
                  {member.useRealDice ? (
                    <Tooltip content="Rolls physical dice: the DM waits for this player to enter real rolls">
                      <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                        real dice
                      </span>
                    </Tooltip>
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
        {seatError ? <p className="mt-2 text-sm text-red-400">{seatError}</p> : null}
      </section>
      ) : null}

      {isLead && (canBuildCompanion || partyCompanions.length > 0) ? (
        <section className="mb-6">
          <h2 className="eyebrow mb-3 flex items-center gap-1.5 text-sm text-amber-200/90">
            <Bot className="size-4" /> Companions
          </h2>
          {partyCompanions.length ? (
            <ul className="mb-2 space-y-2">
              {partyCompanions.map((companion) => (
                <li
                  key={companion.id}
                  className="panel flex items-center justify-between rounded-xl px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {companion.portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={companion.portrait.url}
                        alt=""
                        className="size-10 rounded-lg border border-sky-500/30 object-cover"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-900">
                        <Bot className="size-4 text-sky-300" />
                      </span>
                    )}
                    <div>
                      <p className="font-medium">{companion.name}</p>
                      <p className="text-sm text-stone-400">
                        {companion.race.replaceAll("_", " ")} {companion.class} {companion.level}
                      </p>
                    </div>
                  </div>
                  <Tooltip content="Remove this companion">
                    <button
                      type="button"
                      onClick={() => dismissCompanion(companion.id)}
                      aria-label={`Remove ${companion.name}`}
                      className="rounded-full border border-stone-700 p-1.5 text-stone-500 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : null}
          {canBuildCompanion ? (
            <button
              type="button"
              onClick={() => setBuildingCompanion(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-300 hover:border-sky-700/60 hover:bg-stone-900 hover:text-sky-200"
            >
              <UserPlus className="size-4" /> Add a companion
            </button>
          ) : (
            <p className="text-center text-xs text-stone-500">
              The party has its full number of companions.
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        {isDm ? (
          <div className="panel ornate flex flex-col items-center gap-2 rounded-xl px-6 py-6 text-center">
            <p className="font-display text-lg tracking-wide text-amber-50">
              You are running this game.
            </p>
            <p className="max-w-sm text-balance text-sm text-stone-400">
              No character, no party slot. Ready up when the table is set and the
              adventure is yours to open.
            </p>
            <button
              type="button"
              onClick={toggleReady}
              className={cn(ui.btnPrimary, "mt-1 px-6")}
            >
              {myMember?.ready ? "Not ready" : "Ready"}
            </button>
          </div>
        ) : isSolo ? (
          !mySheet ? (
            <div className="panel ornate flex flex-col items-center gap-3 rounded-xl px-6 py-8 text-center">
              <p className="max-w-sm text-balance font-display text-xl tracking-wide text-amber-50">
                Your adventure needs a hero.
              </p>
              <Link
                href={`/campaigns/${campaign.id}/character`}
                className={cn(ui.btnPrimary, "px-6")}
              >
                Create your character
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                <span className="text-stone-500">{mySheet.name}:</span>
                <Link href={`/campaigns/${campaign.id}/character?mode=edit`} className={ui.btnSmall}>
                  <Pencil className="size-3" /> Edit
                </Link>
                <Link
                  href={`/campaigns/${campaign.id}/character?mode=replace`}
                  className={ui.btnSmall}
                >
                  <UserRound className="size-3" /> Switch
                </Link>
                <button
                  type="button"
                  onClick={removeCharacter}
                  disabled={busy}
                  className={cn(ui.btnSmall, "text-red-300")}
                >
                  <Trash2 className="size-3" /> Remove
                </button>
              </div>
              <button
                type="button"
                onClick={beginSolo}
                disabled={busy}
                className={cn(ui.btnPrimary, "w-full py-2.5")}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Begin the adventure
              </button>
            </>
          )
        ) : (
          <>
            {!mySheet ? (
              <Link href={`/campaigns/${campaign.id}/character`} className={cn(ui.btnPrimary, "w-full")}>
                Create your character
              </Link>
            ) : (
              <>
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
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="text-stone-500">{mySheet.name}:</span>
                  <Link
                    href={`/campaigns/${campaign.id}/character?mode=edit`}
                    className={ui.btnSmall}
                  >
                    <Pencil className="size-3" /> Edit
                  </Link>
                  <Link
                    href={`/campaigns/${campaign.id}/character?mode=replace`}
                    className={ui.btnSmall}
                  >
                    <UserRound className="size-3" /> Switch
                  </Link>
                  <button
                    type="button"
                    onClick={removeCharacter}
                    disabled={busy}
                    className={cn(ui.btnSmall, "text-red-300")}
                  >
                    <Trash2 className="size-3" /> Remove
                  </button>
                </div>
                <p className="text-center text-xs text-stone-600">
                  Changing your character clears your ready status.
                </p>
              </>
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
          </>
        )}
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

      <InviteShareDialog
        open={sharing}
        onOpenChange={setSharing}
        campaignId={campaign.id}
        campaignTitle={campaign.title}
        inviteCode={campaign.inviteCode}
        canRegenerate={isLead}
      />

      {buildingCompanion ? (
        <CompanionBuilderDialog
          campaignId={campaign.id}
          genre={campaign.gameSettings.genre}
          level={campaign.startingLevel}
          onClose={() => setBuildingCompanion(false)}
        />
      ) : null}
    </main>
  );
}
