"use client";

import Link from "next/link";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { ArrowLeft } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { transcribesVoice, useCapabilities } from "@/lib/use-capabilities";
import { roomCodeRefused } from "@/lib/shell-host";
import { useShellShare } from "@/lib/use-shell-share";
import { ScheduleSection } from "@/components/ScheduleSection";
import { ui } from "@/lib/ui";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { LobbyActions } from "@/app/campaigns/[campaignId]/LobbyActions";
import { LobbyParty } from "@/app/campaigns/[campaignId]/LobbyParty";
import { LobbyGroupHead, LobbyHero, LobbyRealDice, enter } from "@/app/campaigns/[campaignId]/LobbyPieces";
import { LobbyRoomCode } from "@/app/campaigns/[campaignId]/LobbyRoomCode";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { PartyStory } from "@/app/campaigns/[campaignId]/PartyStory";
import { mayWritePartyBackstory } from "@/lib/dm/party-story";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { useVoiceSpeaking } from "@/app/campaigns/[campaignId]/liveStore";
import { resolveCompanionMode } from "@/lib/schemas/game-settings";
import { isPrimaryDm, lobbyBlocker, partySlotCount, viewerCaps } from "@/lib/dm/viewer";
import { lobbyNext } from "@/lib/dm/lobby-next";
import {
  ContentImportPicker,
  EMPTY_SELECTION,
  type ImportSelection,
} from "@/app/workshop/ContentImportPicker";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { navigateTo } from "@/lib/navigation";
import { SceneBackdrop } from "@/app/campaigns/[campaignId]/CinematicParts";
import { ArrivalBanner } from "@/app/campaigns/[campaignId]/ArrivalBanner";
import { StorySetupNotice } from "@/components/StorySetupNotice";
import {
  STORY_SETUP_WARNING,
  STORY_SETUP_WARNING_COMING,
  storySetupKeptKey,
  storySetupWillRun,
} from "@/lib/dm/story-setup-logic";

// The companion builder carries the whole character builder (spells,
// gear, the portrait cropper); it and the campaign editor load when they
// are opened, not with the lobby.
const CompanionBuilderDialog = lazy(() =>
  import("@/app/campaigns/[campaignId]/CompanionBuilderDialog").then((module) => ({ default: module.CompanionBuilderDialog })),
);
const EditCampaignDialog = lazy(() =>
  import("@/app/campaigns/[campaignId]/EditCampaignDialog").then((module) => ({ default: module.EditCampaignDialog })),
);

// The lobby: where the table gathers before the adventure opens. On a desktop
// it is a table with two sides: the campaign, its party and this viewer's
// actions (LobbyActions) on the left with the story's prep under them; the
// room code, the schedule, the call and the game's settings on the right. On
// a phone the two sides fold into one column, ordered so the code, the party
// and the Begin button come before the long settings (the order-* classes:
// both columns are display: contents below lg, so their children interleave).
const EMPTY_MESSAGES: never[] = [];

export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { campaign, me, members, sheets } = state;
  const voiceSpeaking = useVoiceSpeaking();
  // The call records and announces a transcript only where it can be written.
  const transcribes = transcribesVoice(useCapabilities());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [buildingCompanion, setBuildingCompanion] = useState(false);
  const [contentImport, setContentImport] = useState<ImportSelection>(EMPTY_SELECTION);
  const [error, setError] = useState("");
  // AI Story Setup meeting an imported Storyboard (issue 249): whether this
  // creator chose to keep it on (remembered per table on this device), and
  // the turn-off request in flight.
  const [storySetupKept, setStorySetupKept] = useState(false);
  const [storySetupBusy, setStorySetupBusy] = useState(false);
  const [storySetupError, setStorySetupError] = useState("");
  const keptCampaignId = campaign?.id ?? "";
  useEffect(() => {
    if (!keptCampaignId) {
      return;
    }
    let kept = false;
    try {
      kept = window.localStorage.getItem(storySetupKeptKey(keptCampaignId)) === "1";
    } catch {
      // Storage refused: the warning simply shows again.
    }
    const timer = window.setTimeout(() => setStorySetupKept(kept), 0);
    return () => window.clearTimeout(timer);
  }, [keptCampaignId]);
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
  const mySheet = sheets.find((sheet) => sheet.id === state.activeSheetId && sheet.userId === me.id)
    ?? sheets.find((sheet) => sheet.userId === me.id && !sheet.isCompanion);
  const mySheets = sheets.filter((sheet) => sheet.userId === me.id && !sheet.isCompanion);
  async function selectCharacter(characterId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/sheet/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error || "Could not select the character.");
      } else refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
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
  const { steersStory, adjudicates } = viewerCaps(seats, me.id);
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
  // AI Story Setup meeting the table's prep (issue 249): the one-time pass
  // is still to run at a table the AI narrates, and either an imported
  // Storyboard already wrote the arc (state.prepArc, told only to whoever
  // steers) or the board picked under "Bring in prep" is about to.
  const setupWillRun =
    steersStory &&
    !storySetupKept &&
    storySetupWillRun({
      status: campaign.status,
      dmMode: campaign.gameSettings.dmMode,
      aiStorySetup: campaign.gameSettings.aiStorySetup,
      outlineWritten: false,
    });
  async function turnOffStorySetup() {
    setStorySetupBusy(true);
    setStorySetupError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiStorySetup: false }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setStorySetupError(data.error || "Could not change the setting.");
      }
    } catch {
      setStorySetupError("Could not reach the server.");
    } finally {
      setStorySetupBusy(false);
    }
  }
  function keepStorySetup() {
    try {
      window.localStorage.setItem(storySetupKeptKey(campaign!.id), "1");
    } catch {
      // Storage refused: it is kept for this visit only.
    }
    setStorySetupKept(true);
  }
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

  // The one line above the actions that says what happens next for this
  // viewer, from the same seats the Begin button reads.
  const others = members.filter((member) => member.userId !== me.id && !isDmSeatOf(member.userId));
  const next = lobbyNext({
    solo: isSolo,
    isDm,
    hasSheet: Boolean(mySheet),
    ready: Boolean(myMember?.ready),
    canStart: isOwner || isPrimaryDm(seats, me.id),
    blocker: startBlocker,
    needHero: others.filter((member) => !sheets.some((sheet) => sheet.userId === member.userId)).map((member) => member.username),
    notReady: others.filter((member) => !member.ready).map((member) => member.username),
  });
  function isDmSeatOf(userId: string) {
    return userId === campaign!.dmUserId || userId === campaign!.assistantDmUserId;
  }

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
    <main className="cine-stage cine-lobby mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6 lg:max-w-6xl">
      {/* The lobby under the same sky as the table: the cover art behind
          the panels, dimmed, so the door and the room read as one place. */}
      <SceneBackdrop messages={EMPTY_MESSAGES} cover={campaign.cover} genre={campaign.genre} seed={campaign.id} />
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-stone-500 transition-colors hover:text-amber-200"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col">
          {/* A player taking a seat, for everyone here (F27): the banner
              rides on the lobby card's art, so it never covers another
              card's words. */}
          <div className="relative order-1">
            <LobbyHero
              campaign={campaign}
              canEdit={isLead}
              onEdit={() => setEditing(true)}
              className="lobby-enter"
              style={enter(0)}
            />
            <ArrivalBanner sheets={sheets} />
          </div>

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
            {campaign.gameSettings.multiCharacter !== "off" && mySheets.length > 1 ? (
              <div className="mb-3 flex flex-wrap justify-center gap-2" aria-label="Your characters">
                {mySheets.map((sheet) => (
                  <button key={sheet.id} type="button" disabled={busy}
                    aria-pressed={mySheet?.id === sheet.id}
                    onClick={() => void selectCharacter(sheet.id)}
                    className={cn(ui.btnSecondary, "px-3 py-1 text-xs", mySheet?.id === sheet.id && "border-amber-400 text-amber-200")}>
                    {sheet.name}
                  </button>
                ))}
              </div>
            ) : null}
            {setupWillRun && state.prepArc ? (
              <StorySetupNotice
                text={STORY_SETUP_WARNING}
                busy={storySetupBusy}
                error={storySetupError}
                onTurnOff={() => void turnOffStorySetup()}
                onKeep={keepStorySetup}
                className="mb-3"
              />
            ) : null}
            <LobbyActions
              next={next}
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

          {/* Optional, and written once characters have joined: how this
              party knows each other. Right after the actions so a phone
              reaches Begin first. */}
          <section className="lobby-enter order-4 mb-6" style={enter(4)}>
            <LobbyGroupHead glyph="tab-party" title="Party story" />
            <div className={cn(ui.card, "p-3")}>
              <PartyStory
                campaignId={campaign.id}
                party={campaign.party}
                canWrite={mayWritePartyBackstory({ isLead, holdsDmSeat: isDm, hasCharacter: mySheets.length > 0 })}
                hasCharacters={sheets.some((sheet) => !(sheet.isCompanion && sheet.companionKind === "guest"))}
              />
            </div>
          </section>

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
              isDm={adjudicates}
            />
            <LorePanel campaignId={campaign.id} steersStory={steersStory} isDm={adjudicates} />
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
                  storyboardNote={(arcComing) =>
                    arcComing && setupWillRun ? (
                      <StorySetupNotice
                        text={STORY_SETUP_WARNING_COMING}
                        busy={storySetupBusy}
                        error={storySetupError}
                        onTurnOff={() => void turnOffStorySetup()}
                        onKeep={keepStorySetup}
                      />
                    ) : null
                  }
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
              codeRefused={roomCodeRefused(share.status, campaign.inviteCode)}
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
                adjudicates={adjudicates}
                steersStory={steersStory}
                transcribe={campaign.gameSettings.voice.transcribe && transcribes}
              />
              {campaign.gameSettings.voice.transcribe && transcribes ? (
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
              heading={false}
              solo={campaign.maxPlayers <= 1}
            />
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}

      {buildingCompanion ? (
        <CompanionBuilderDialog
          campaignId={campaign.id}
          genre={campaign.gameSettings.genre}
          worldPackId={campaign.gameSettings.worldPack}
          level={campaign.startingLevel}
          humanDm={humanDmTable}
          onClose={() => setBuildingCompanion(false)}
        />
      ) : null}
      </Suspense>
    </main>
  );
}
