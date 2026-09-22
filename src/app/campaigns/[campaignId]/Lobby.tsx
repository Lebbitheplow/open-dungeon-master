"use client";

import Link from "next/link";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useShellShare } from "@/lib/use-shell-share";
import { ScheduleSection } from "@/components/ScheduleSection";
import { ui } from "@/lib/ui";
import { CompanionBuilderDialog } from "@/app/campaigns/[campaignId]/CompanionBuilderDialog";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { LobbyActions } from "@/app/campaigns/[campaignId]/LobbyActions";
import { LobbyParty } from "@/app/campaigns/[campaignId]/LobbyParty";
import { LobbyGroupHead, LobbyHero, LobbyRealDice, enter } from "@/app/campaigns/[campaignId]/LobbyPieces";
import { LobbyRoomCode } from "@/app/campaigns/[campaignId]/LobbyRoomCode";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { useVoiceSpeaking } from "@/app/campaigns/[campaignId]/liveStore";
import { resolveCompanionMode } from "@/lib/schemas/game-settings";
import { isPrimaryDm, lobbyBlocker, partySlotCount, viewerCaps } from "@/lib/dm/viewer";
import {
  ContentImportPicker,
  EMPTY_SELECTION,
  type ImportSelection,
} from "@/app/workshop/ContentImportPicker";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { navigateTo } from "@/lib/navigation";

// The lobby: where the table gathers before the adventure opens. On a desktop
// it is a table with two sides: the campaign, its party and this viewer's
// actions (LobbyActions) on the left with the story's prep under them; the
// room code, the schedule, the call and the game's settings on the right. On
// a phone the two sides fold into one column, ordered so the code, the party
// and the Begin button come before the long settings (the order-* classes:
// both columns are display: contents below lg, so their children interleave).
export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const voiceSpeaking = useVoiceSpeaking();
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

  // Inside the desktop or Android app, on the app's own world: the state of
  // the tunnel, watched but never started here. Opening a lobby is not
  // asking to be online; the host says when, from the invite dialog or the
  // app's own share screen. Elsewhere this is inert.
  const share = useShellShare(false);
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
  // The campaign's seats, in the shape every rule in src/lib/dm/viewer.ts
  // takes. Built once here so the caps, the party count and the start gate
  // below cannot drift apart.
  const seats = {
    ownerUserId: campaign.ownerUserId,
    leadUserId: campaign.leadUserId,
    humanDmUserId: campaign.dmUserId,
    assistantDmUserId: campaign.assistantDmUserId,
    dmMode: campaign.gameSettings.dmMode,
  };
  // Who holds the story's secrets and steers it: the lead in an AI-run
  // campaign, the DM once a person runs it. Decided by src/lib/dm/viewer.ts
  // rather than by comparing ids here, which is the rule that module exists
  // to enforce.
  const { steersStory } = viewerCaps(seats, me.id);
  // One-player campaigns skip the invite/party ceremony entirely. A table with
  // a person in the DM seat is never solo, however small: the DM holds no
  // party slot, so maxPlayers 1 there still means two people who need the room
  // code, the call and the ordinary ready-then-begin flow between them.
  const isSolo = campaign.maxPlayers === 1 && !humanDmTable;
  // Players, not seats: the DM occupies neither a party slot nor a character.
  const partySize = partySlotCount(seats, members.map((member) => member.userId));

  // Whoever steers the story can prepare lasting party companions here: the
  // lead in an AI-run campaign, the DM once a person runs it. The DM's is the
  // case that matters most, because an ally the DM plays is the only way for
  // someone running a human table to hold a character sheet at all, and the
  // /companions/create route has always allowed it (requireStoryAuthority).
  // Only party companions are built by hand, so the option shows only where
  // the table allows them.
  const partyCompanions = sheets.filter(
    (sheet) => sheet.isCompanion && sheet.companionKind !== "guest",
  );
  const canBuildCompanion =
    steersStory &&
    resolveCompanionMode(campaign.gameSettings, partySize, humanDmTable) === "full" &&
    partyCompanions.length < campaign.gameSettings.maxCompanions;
  const showCompanions = canBuildCompanion || (steersStory && partyCompanions.length > 0);
  // Why the adventure cannot open yet, or "" when it can. The server's PATCH
  // asks the same function of the same seats, so the Begin button is enabled
  // exactly when the route would accept it.
  const startBlocker = lobbyBlocker(
    seats,
    members.map((member) => ({
      userId: member.userId,
      ready: member.ready,
      hasSheet: sheets.some((sheet) => sheet.userId === member.userId),
    })),
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

  async function muteMember(userId: string, muted: boolean) {
    await fetch(`/api/campaigns/${campaign!.id}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, muted }),
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
      !await appConfirm(
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
      !await appConfirm(
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
      navigateTo("/");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6 lg:max-w-6xl">
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-stone-500 transition-colors hover:text-amber-200"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col">
          <LobbyHero
            campaign={campaign}
            canEdit={isLead}
            onEdit={() => setEditing(true)}
            className="lobby-enter order-1"
            style={enter(0)}
          />

          {!isSolo || showCompanions ? (
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
              canMute={isLead || isOwner}
              onMute={muteMember}
              showParty={!isSolo}
              showCompanions={showCompanions}
              partyCompanions={partyCompanions}
              canBuildCompanion={canBuildCompanion}
              onBuildCompanion={() => setBuildingCompanion(true)}
              onDismissCompanion={dismissCompanion}
              className="lobby-enter order-3"
              style={enter(2)}
            />
          ) : null}

          <div className="lobby-enter order-4 mb-8" style={enter(3)}>
            <LobbyActions
              campaign={campaign}
              myMember={myMember}
              mySheet={mySheet}
              isDm={isDm}
              isSolo={isSolo}
              isOwner={isOwner}
              canStart={isOwner || isPrimaryDm(seats, me.id)}
              busy={busy}
              error={error}
              startBlocker={startBlocker}
              onToggleReady={() => void setReady(!myMember?.ready)}
              onStart={() => void activate("Could not start the campaign.")}
              onBeginSolo={() => void beginSolo()}
              onRemoveCharacter={() => void removeCharacter()}
              onDelete={() => void deleteCampaign()}
            />
          </div>

          {/* Settings, rules and lore are story authority (the lead at an AI
              table, the DM once a person runs it), which is what their routes
              check. Handing them to the lead alone drew editable panels for a
              player-lead the server would refuse and read-only ones for the DM. */}
          <section className="lobby-enter order-9 mb-6 space-y-3" style={enter(5)}>
            <LobbyGroupHead glyph="tab-story" title="Rules and lore" />
            <RulesPanel
              campaignId={campaign.id}
              settings={campaign.gameSettings}
              steersStory={steersStory}
            />
            <LorePanel campaignId={campaign.id} steersStory={steersStory} />
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
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col">
          {!isSolo ? (
            <LobbyRoomCode
              campaignId={campaign.id}
              campaignTitle={campaign.title}
              inviteCode={campaign.inviteCode}
              canRegenerate={isLead}
              shareUrl={shareUrl}
              className="lobby-enter order-2"
              style={enter(1)}
            />
          ) : null}

          {/* When the humans actually meet. Solo campaigns schedule nothing. */}
          {!isSolo ? (
            <ScheduleSection
              campaignId={campaign.id}
              meUserId={me.id}
              isLead={isLead}
              usernames={Object.fromEntries(members.map((member) => [member.userId, member.username]))}
              avatars={Object.fromEntries(members.map((member) => [member.userId, member.avatar?.url]))}
              version={state.scheduleVersion}
              className="lobby-enter order-5"
              style={enter(2)}
            />
          ) : null}

          {campaign.gameSettings.dicePolicy === "real_allowed" && mySheet ? (
            <LobbyRealDice
              on={Boolean(myMember?.useRealDice)}
              onToggle={() => void toggleRealDice()}
              className="lobby-enter order-6"
              style={enter(3)}
            />
          ) : null}

          {/* The call is open in the lobby, so the table can talk while people
              are still building characters. Pointless in a solo campaign, which
              is the same reason the party list is hidden there. No floor to
              show: the game has not started, so everyone can talk. */}
          {!isSolo ? (
            <section className="reveal lobby-enter order-7 mb-6" style={enter(3)}>
              <VoicePanel
                campaignId={campaign.id}
                meUserId={me.id}
                roster={state.voiceRoster}
                speaking={voiceSpeaking}
                audibilityVersion={state.voiceAudibilityVersion}
                meshSignal={state.voiceMeshSignal}
                adjudicates={steersStory}
                transcribe={campaign.gameSettings.voice.transcribe}
              />
              {campaign.gameSettings.voice.transcribe ? (
                <p className="reveal mt-2 text-xs text-amber-300/80">
                  This table is transcribed: while voice is on, what each person says is written down with their name for the story log. Turn it off in campaign settings.
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="lobby-enter order-8" style={enter(4)}>
            <LobbyGroupHead glyph="tab-settings" title="Table settings" />
            <GameSettingsPanel
              campaignId={campaign.id}
              settings={campaign.gameSettings}
              steersStory={steersStory}
            />
          </div>
        </div>
      </div>

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}

      {buildingCompanion ? (
        <CompanionBuilderDialog
          campaignId={campaign.id}
          genre={campaign.gameSettings.genre}
          level={campaign.startingLevel}
          humanDm={humanDmTable}
          onClose={() => setBuildingCompanion(false)}
        />
      ) : null}
    </main>
  );
}
