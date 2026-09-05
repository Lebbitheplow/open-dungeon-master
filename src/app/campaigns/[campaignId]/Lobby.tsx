"use client";

import Link from "next/link";
import { ArrowLeft, Dices, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useShellShare } from "@/lib/use-shell-share";
import { CampaignCover } from "@/components/CampaignCover";
import { ScheduleSection } from "@/components/ScheduleSection";
import { Tooltip } from "@/components/ui/Tooltip";
import { ui } from "@/lib/ui";
import { CompanionBuilderDialog } from "@/app/campaigns/[campaignId]/CompanionBuilderDialog";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { LobbyActions } from "@/app/campaigns/[campaignId]/LobbyActions";
import { LobbyParty } from "@/app/campaigns/[campaignId]/LobbyParty";
import { LobbyRoomCode } from "@/app/campaigns/[campaignId]/LobbyRoomCode";
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

// The lobby: where the table gathers before the adventure opens. The cover
// art and title lead, then the room code, the game's settings and prep,
// the call, the schedule, the party and finally the block of actions that
// belongs to this viewer's seat (LobbyActions).
export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [buildingCompanion, setBuildingCompanion] = useState(false);
  const [contentImport, setContentImport] = useState<ImportSelection>(EMPTY_SELECTION);
  const [error, setError] = useState("");
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
  const isDm = me.id === campaign.dmUserId || me.id === campaign.assistantDmUserId;
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
  const partyCompanions = sheets.filter(
    (sheet) => sheet.isCompanion && sheet.companionKind !== "guest",
  );
  const canBuildCompanion =
    isLead &&
    resolveCompanionMode(campaign.gameSettings, members.length) === "full" &&
    partyCompanions.length < campaign.gameSettings.maxCompanions;
  const allReady = members.length > 0 && members.every((member) => member.ready);
  const allHaveSheets = members.every((member) =>
    sheets.some((sheet) => sheet.userId === member.userId),
  );

  // Returns whether the server took it, so the solo flow can stop before
  // trying to start a game whose only player is not ready.
  async function setReady(ready: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not change your ready state.");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // PATCHes the campaign live. Shared by the owner's Begin button and the
  // solo one-stroke start.
  async function activate(failure: string) {
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
        setError(data.error || failure);
        return;
      }
      refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // Solo flow: one button readies up and starts in a single stroke.
  async function beginSolo() {
    if (!myMember?.ready && !(await setReady(true))) {
      return;
    }
    await activate("Could not start the adventure.");
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
      <header className="mb-6">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-stone-500 transition-colors hover:text-amber-200"
        >
          <ArrowLeft className="size-4" /> All campaigns
        </Link>
        <div className={cn(ui.card, "ornate texture-noise flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5")}>
          <CampaignCover
            cover={campaign.cover}
            title={campaign.title}
            className="w-full shrink-0 sm:w-44"
          />
          <div className="min-w-0 flex-1">
            <p className={ui.sectionEyebrow}>Waiting in the lobby</p>
            <h1 className="mt-1 flex items-center gap-2 font-display text-2xl tracking-wide text-amber-50">
              <span className="truncate">{campaign.title}</span>
              {isLead ? (
                <Tooltip content="Edit campaign settings">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit campaign settings"
                    className="shrink-0 rounded-md border border-stone-700/70 p-1.5 text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tooltip>
              ) : null}
            </h1>
            <p className="mt-1 text-sm text-stone-400">
              Level {campaign.startingLevel} start · {campaign.difficulty}
              {campaign.theme ? ` · ${campaign.theme}` : ""}
            </p>
            {campaign.description ? (
              <p className="mt-2 text-sm text-stone-300">{campaign.description}</p>
            ) : null}
          </div>
        </div>
      </header>

      {!isSolo ? (
        <LobbyRoomCode
          campaignId={campaign.id}
          campaignTitle={campaign.title}
          inviteCode={campaign.inviteCode}
          canRegenerate={isLead}
          shareUrl={shareUrl}
        />
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
          <div className={cn(ui.card, "p-3")}>
            <h2 className={cn(ui.sectionEyebrow, "mb-2")}>Bring in prep</h2>
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
        <section className={cn(ui.card, "mb-6 flex items-center justify-between gap-3 px-4 py-3")}>
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
              ui.btnSmall,
              myMember?.useRealDice && "border-amber-500/40 bg-amber-400/10 text-amber-200",
            )}
          >
            <Dices className="size-4" />
            {myMember?.useRealDice ? "Real dice" : "Digital"}
          </button>
        </section>
      ) : null}

      {/* The call is open in the lobby, so the table can talk while people
          are still building characters. Pointless in a solo campaign, which
          is the same reason the party list is hidden there. No floor to
          show: the game has not started, so everyone can talk. */}
      {!isSolo ? (
        <section className="mb-6">
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

      {!isSolo || (isLead && (canBuildCompanion || partyCompanions.length > 0)) ? (
        <LobbyParty
          campaign={campaign}
          members={members}
          sheets={sheets}
          canMakeLead={isLead || isOwner}
          humanDmTable={humanDmTable}
          canAssignSeats={canAssignSeats}
          seatError={seatError}
          onMakeLead={makeLead}
          onAssignSeat={assignSeat}
          showParty={!isSolo}
          showCompanions={isLead && (canBuildCompanion || partyCompanions.length > 0)}
          partyCompanions={partyCompanions}
          canBuildCompanion={canBuildCompanion}
          onBuildCompanion={() => setBuildingCompanion(true)}
          onDismissCompanion={dismissCompanion}
        />
      ) : null}

      <LobbyActions
        campaign={campaign}
        myMember={myMember}
        mySheet={mySheet}
        isDm={isDm}
        isSolo={isSolo}
        isOwner={isOwner}
        busy={busy}
        error={error}
        allReady={allReady}
        allHaveSheets={allHaveSheets}
        onToggleReady={() => void setReady(!myMember?.ready)}
        onStart={() => void activate("Could not start the campaign.")}
        onBeginSolo={() => void beginSolo()}
        onRemoveCharacter={() => void removeCharacter()}
        onDelete={() => void deleteCampaign()}
      />

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}

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
