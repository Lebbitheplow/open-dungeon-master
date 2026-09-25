"use client";

import { BookMarked, BookOpen, Flag, Heart, History, ListChecks, ScrollText, ShoppingBag, Users } from "lucide-react";
import { FactionsPanel } from "@/app/campaigns/[campaignId]/FactionsPanel";
import { MarketPanel } from "@/app/campaigns/[campaignId]/MarketPanel";
import { useMemo, useState, type ReactNode } from "react";
import { DmConsolePanel } from "@/app/campaigns/[campaignId]/DmConsolePanel";
import { LeadPanel } from "@/app/campaigns/[campaignId]/LeadPanel";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import { BattleMapPanel } from "@/app/campaigns/[campaignId]/BattleMapPanel";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { CameraEvent, SceneState } from "@/lib/scene/state";
import type { MapLabel } from "@/lib/battlemap/scene";
import { DmWhisperPanel } from "@/app/campaigns/[campaignId]/DmWhisperPanel";
import { EncounterPanel } from "@/app/campaigns/[campaignId]/EncounterPanel";
import { EventLog } from "@/app/campaigns/[campaignId]/EventLog";
import { BondsPanel } from "@/app/campaigns/[campaignId]/BondsPanel";
import { FactsPanel } from "@/app/campaigns/[campaignId]/FactsPanel";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { MapPanel } from "@/app/campaigns/[campaignId]/MapPanel";
import { NotesPanel } from "@/app/campaigns/[campaignId]/NotesPanel";
import { OverworldPanel } from "@/app/campaigns/[campaignId]/OverworldPanel";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import { ContextPanel } from "@/app/campaigns/[campaignId]/ContextPanel";
import { PinsPanel } from "@/app/campaigns/[campaignId]/PinsPanel";
import { SessionSettings } from "@/app/campaigns/[campaignId]/SessionSettings";
import { SideChatPanel } from "@/app/campaigns/[campaignId]/SideChatPanel";
import { StoryPanel } from "@/app/campaigns/[campaignId]/StoryPanel";
import { attributeSpeech, speakersIn } from "@/lib/dm/speech";
import type { CastMember } from "@/lib/dm/cast";
import { QuestsPanel } from "@/app/campaigns/[campaignId]/QuestsPanel";
import { TimelinePanel } from "@/app/campaigns/[campaignId]/TimelinePanel";
import {
  SubTabs,
  type PanelTab,
  type PartySection,
  type StorySection,
  type SubTabDef,
} from "@/app/campaigns/[campaignId]/SessionTabs";
import type {
  AuditEntry,
  CampaignLocation,
  MediaStatus,
} from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMember } from "@/lib/campaign-types";
import { allDelegations, type DmCover } from "@/lib/dm/delegation";
import type { Floor } from "@/lib/db/campaigns";
import type { Chapter } from "@/lib/db/chapters";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { Note } from "@/lib/db/notes";
import type { WorldFact } from "@/lib/db/facts";
import type { DmWhisper } from "@/lib/db/dm-whispers";
import type { SideThread } from "@/lib/db/side-chat";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { MapPing } from "@/lib/dm/board-logic";
import { companionSlotsFree, resolveCompanionMode } from "@/lib/schemas/game-settings";
import { hasHumanDm, partySlotCount } from "@/lib/dm/viewer";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Everything the side panel's content needs. SidePanel adds the rail's own
// props (the tab list, badges, the mobile switch) on top of these.
export type SidePanelRouterProps = {
  campaignId: string;
  // A level-up the sheet's experience has earned while its dialog is not
  // open: the level it reaches, and how the party card opens it.
  levelUpLevel?: number | null;
  onLevelUp?: () => void;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  cast: CastMember[];
  meUserId: string;
  // Runs the story: the party lead in an AI campaign, the DM in a human-run
  // one. Gates every panel that curates the world or fixes its numbers.
  steersStory: boolean;
  // Owns the table: invites and campaign info. Stays with the lead even when
  // a DM has taken the story, which is why these are two props and not one.
  isLead: boolean;
  // Holds the DM seat, so the console tab exists at all.
  adjudicates: boolean;
  // The chat, for the console's queue of unanswered player actions.
  messages: CampaignMessage[];
  dmIntents: Array<{ messageId: string; userId: string; characterId: string; seq: number }>;
  // Who may speak right now: the console's floor control reads the mode,
  // the lead's desk reads the whole thing (who is spotlit, who has answered).
  floor: Floor;
  // Story the DM has already written down, newest first.
  beats: DmBeat[];
  // The stream's director flag, for the armed banner on the lead's desk.
  directorArm?: Parameters<typeof LeadPanel>[0]["directorArm"];
  leadUserId: string;
  canTransferLead: boolean;
  spotlightUserIds: string[];
  // Who has the campaign open in a live tab (presence ephemeral), for the
  // party cards' online dots.
  onlineUserIds?: string[];
  auditLog: AuditEntry[];
  locations: CampaignLocation[];
  chapters: Chapter[];
  notes: Note[];
  facts: WorldFact[];
  characterEvents: CharacterEvent[];
  refreshNotes: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  // Bumped by SessionView on pin/unpin so the pins list refetches.
  pinsVersion: number;
  sideThreads: SideThread[];
  refreshSideChat: () => Promise<void>;
  whispers: DmWhisper[];
  whisperUnread: number;
  refreshWhispers: () => Promise<void>;
  chatTarget: string | null;
  onChatTargetHandled: () => void;
  onMessageUser: (userId: string) => void;
  mediaStatus: Record<string, MediaStatus>;
  inviteCode?: string;
  midGameJoinOpen?: boolean;
  // The settings panel's shape plus the two DM seats, which the lead's desk
  // needs to keep them out of the "make lead" list.
  campaign?: Parameters<typeof SessionSettings>[0]["campaign"] & {
    dmUserId?: string | null;
    assistantDmUserId?: string | null;
  };
  // Assisted mode: the stretch of answers the DM handed to the AI. Separate
  // from `campaign` because that shape carries only what the settings panel edits.
  dmCover?: DmCover | null;
  encounter?: PublicEncounter | null;
  battleMap?: PlayerMapView | null;
  mapPing?: MapPing | null;
  // Effects planned for the board and the DM's camera, with their
  // acknowledgements (useCampaignStream.ts).
  fx?: FxEvent[];
  onFxPlayed?: (ids: string[]) => void;
  camera?: CameraEvent | null;
  onCameraDone?: () => void;
  // Puts words in the composer: the board HUD's shortcut to an action.
  onCompose?: (text: string) => void;
  // The sky over the table, for the board and the scene art.
  scene?: SceneState | null;
  // Whether this seat may draw on the live board.
  canDraw?: boolean;
  // A pinned map label was tapped: open what it points at.
  onOpenLabel?: (label: MapLabel) => void;
  refreshBattleMap: () => Promise<void>;
  // The chronicle scroll for the enlarged board (CinematicParts.tsx).
  tabletopChronicle?: ReactNode;
  // The board is on the table (the fight stage), so the Battle tab shows
  // the party and the turn order instead of a second board.
  stageBoard?: boolean;
  tab: PanelTab;
  // Bumped by the relationships_updated ephemeral; the Bonds panel refetches
  // its own scoped view when it changes.
  relationshipsVersion: number;
  factionsVersion?: number;
  shopsVersion?: number;
  coins?: { characterId: string; direction: "in" | "out"; amountCp: number; at: number } | null;
  activeSheetId?: string;
  questsVersion: number;
  // Gates the Bonds sub-tab. This used to withhold a top-level tab inside
  // buildPanelTabs; Bonds is a Party section now, so the flag has to reach
  // this component instead.
  relationshipsEnabled: boolean;
  // Whether the panel is on screen. Below lg the panel stays mounted behind
  // the chat, so the panels with animation loops (the region map's pulse,
  // the board's weather) rest on this rather than on document.hidden alone.
  visible?: boolean;
};

// Which panel the active tab shows. Every PanelTab has an explicit branch;
// the guards on dm, lead, battle and context are belt and braces over
// buildPanelTabs, so a stale selection never lands a player on a panel whose
// route will only ever answer 403.
export function SidePanelRouter({
  campaignId,
  levelUpLevel = null,
  onLevelUp,
  sheets,
  members,
  cast,
  meUserId,
  steersStory,
  isLead,
  leadUserId,
  canTransferLead,
  spotlightUserIds,
  onlineUserIds,
  auditLog,
  locations,
  chapters,
  notes,
  facts,
  characterEvents,
  refreshNotes,
  refreshFacts,
  pinsVersion,
  sideThreads,
  refreshSideChat,
  whispers,
  whisperUnread,
  refreshWhispers,
  chatTarget,
  onChatTargetHandled,
  onMessageUser,
  mediaStatus,
  inviteCode,
  midGameJoinOpen,
  campaign,
  dmCover,
  encounter,
  battleMap,
  mapPing,
  fx,
  onFxPlayed,
  camera,
  onCameraDone,
  onCompose,
  scene,
  canDraw,
  onOpenLabel,
  refreshBattleMap,
  tabletopChronicle,
  stageBoard = false,
  tab: rawTab,
  relationshipsVersion,
  factionsVersion = 0,
  shopsVersion = 0,
  coins = null,
  activeSheetId = "",
  questsVersion,
  relationshipsEnabled,
  visible = true,
  adjudicates,
  messages,
  dmIntents,
  floor,
  beats,
  directorArm,
}: SidePanelRouterProps) {
  // Which section of Party and Story is showing. Local state: nothing outside
  // this panel reads or sets them.
  const [partySection, setPartySection] = useState<PartySection>("party");
  const [storySection, setStorySection] = useState<StorySection>("story");

  const partySubTabs: SubTabDef<PartySection>[] = [
    ["party", "Roster", Users],
    ...(relationshipsEnabled ? ([["bonds", "Bonds", Heart]] as SubTabDef<PartySection>[]) : []),
    ["factions", "Factions", Flag],
    ["market", "Market", ShoppingBag],
  ];
  const storySubTabs: SubTabDef<StorySection>[] = [
    ["story", "Chapters", BookOpen],
    ["quests", "Quests", ListChecks],
    ["timeline", "Timeline", History],
    ["facts", "Facts", BookMarked],
    ["log", "Log", ScrollText],
  ];

  // Who is running the game, in the shape src/lib/dm/viewer.ts asks for. The
  // companion rules below are counted in party slots, not in people at the
  // table: a DM seat is not a player, so counting it used to drop a one-player
  // human-run table out of "auto" companions.
  const dmSeats = {
    dmMode: campaign?.gameSettings?.dmMode ?? "ai",
    humanDmUserId: campaign?.dmUserId ?? null,
    assistantDmUserId: campaign?.assistantDmUserId ?? null,
  };
  const humanDmTable = hasHumanDm(dmSeats);

  // Theatre inserts (docs/vtt-parity-implementation-plan.md 8.3): the
  // speakers of the latest DM passage, when the table asked for faces.
  const theatreInserts = useMemo(() => {
    if (campaign?.gameSettings?.presentation !== "theatre") {
      return null;
    }
    const latest = [...messages].reverse().find((message) => message.authorType === "dm");
    if (!latest) {
      return null;
    }
    const speakers = latest.speaker
      ? [latest.speaker]
      : speakersIn(attributeSpeech(latest.content, cast.map((member) => ({ kind: "npc" as const, id: member.id, name: member.name }))));
    return { speakers, cast, messageId: latest.id };
  }, [campaign?.gameSettings?.presentation, messages, cast]);
  const partySize = partySlotCount(
    dmSeats,
    members.map((member) => member.userId),
  );

  const tab: PanelTab = stageBoard && rawTab === "battle" ? "party" : rawTab;
  if (tab === "dm" && adjudicates) {
    return (
      <DmConsolePanel
        campaignId={campaignId}
        sheets={sheets}
        encounter={encounter ?? null}
        messages={messages}
        intents={dmIntents}
        floorMode={floor.mode}
        beats={beats}
        delegations={allDelegations(
          campaign?.gameSettings?.dmMode,
          campaign?.gameSettings?.dmAssist,
        )}
        cover={dmCover ?? null}
        variantRules={{
          powerfulCritical: campaign?.gameSettings?.variantRules?.powerfulCritical ?? false,
          criticalDamageMods: campaign?.gameSettings?.variantRules?.criticalDamageMods ?? false,
        }}
      />
    );
  }
  if (tab === "lead" && isLead && campaign) {
    // useSessionTabs falls off this tab when the seat moves, but a stale
    // selection must not show a player the invite code.
    return (
      <LeadPanel
        campaignId={campaignId}
        campaign={campaign}
        floor={floor}
        sheets={sheets}
        members={members}
        notes={notes}
        refreshNotes={refreshNotes}
        meUserId={meUserId}
        inviteCode={inviteCode}
        midGameJoinOpen={midGameJoinOpen ?? false}
        canTransferLead={canTransferLead}
        leadUserId={leadUserId}
        steersStory={steersStory}
        isLead={isLead}
        encounter={encounter}
        directorArm={directorArm}
      />
    );
  }
  if (tab === "party") {
    return (
      <>
        {partySubTabs.length > 1 ? (
          <SubTabs tabs={partySubTabs} value={partySection} onChange={setPartySection} />
        ) : null}
        <div key={partySection} className="motion-tab">
          {partySection === "bonds" ? (
            <BondsPanel campaignId={campaignId} refreshKey={relationshipsVersion} />
          ) : partySection === "factions" ? (
            <FactionsPanel campaignId={campaignId} steersStory={steersStory} refreshKey={factionsVersion} />
          ) : partySection === "market" ? (
            <MarketPanel
              campaignId={campaignId}
              steersStory={steersStory}
              isDm={adjudicates}
              mySheet={sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets.find((sheet) => sheet.userId === meUserId && !sheet.isCompanion) ?? null}
              refreshKey={shopsVersion}
              coins={coins}
            />
          ) : (
            <>
              {encounter ? (
                <div className="reveal mb-3">
                  <EncounterPanel
                    campaignId={campaignId}
                    encounter={encounter}
                    steersStory={steersStory}
                    canEditOrder={adjudicates}
                    embedded
                    genre={campaign?.gameSettings?.genre}
                    sheets={sheets}
                  />
                </div>
              ) : null}
              <PartyPanel
                sheets={sheets}
                meUserId={meUserId}
                spotlightUserIds={spotlightUserIds}
                onlineUserIds={onlineUserIds}
                steersStory={steersStory}
                leadUserId={leadUserId}
                canTransferLead={canTransferLead}
                notes={notes}
                members={members}
                refreshNotes={refreshNotes}
                onMessageUser={onMessageUser}
                realDiceAllowed={campaign?.gameSettings?.dicePolicy === "real_allowed"}
                encumbranceRule={Boolean(campaign?.gameSettings?.variantRules?.encumbrance)}
                inCombat={Boolean(encounter)}
                campaignId={campaignId}
                worldPack={campaign?.gameSettings?.worldPack ?? ""}
                lights={Object.fromEntries((battleMap?.tokens ?? []).filter((token) => token.kind === "pc" && token.light).map((token) => [token.refId, token.light!]))}
                activeSheetId={activeSheetId}
                multiCharacter={campaign?.gameSettings?.multiCharacter ?? "off"}
                levelUpLevel={levelUpLevel}
                onLevelUp={onLevelUp}
                companionsAvailable={
                  campaign?.gameSettings
                    ? companionSlotsFree(
                        campaign.gameSettings,
                        partySize,
                        sheets
                          .filter((sheet) => sheet.isCompanion)
                          .map((sheet) => (sheet.companionKind === "guest" ? "guest" : "party")),
                        humanDmTable,
                      )
                    : false
                }
                companionBuildAvailable={
                  campaign?.gameSettings
                    ? resolveCompanionMode(campaign.gameSettings, partySize, humanDmTable) === "full" &&
                      sheets.filter((sheet) => sheet.isCompanion && sheet.companionKind !== "guest")
                        .length < campaign.gameSettings.maxCompanions
                    : false
                }
                humanDmTable={humanDmTable}
                companionGenre={campaign?.gameSettings?.genre}
                companionLevel={(() => {
                  const levels = sheets
                    .filter((sheet) => !sheet.isCompanion)
                    .map((sheet) => sheet.level);
                  return levels.length
                    ? Math.max(1, Math.round(levels.reduce((sum, n) => sum + n, 0) / levels.length))
                    : (campaign?.startingLevel ?? 1);
                })()}
                embedded
              />
            </>
          )}
        </div>
      </>
    );
  }
  if (tab === "battle" && battleMap) {
    return (
      <BattleMapPanel
        campaignId={campaignId}
        view={battleMap}
        intents={battleMap.intents}
        genre={campaign?.gameSettings?.genre ?? null}
        turnBudget={
          encounter?.turn && sheets.some((sheet) => sheet.id === encounter.turn?.ownerId && sheet.userId === meUserId)
            ? { action: !encounter.turn.actionUsed, bonus: !encounter.turn.bonusUsed, reaction: !encounter.turn.reactionUsed }
            : null
        }
        canDirect={adjudicates}
        canFocusPing={steersStory}
        ping={mapPing ?? null}
        fx={fx}
        onFxPlayed={onFxPlayed}
        camera={camera ?? null}
        onCameraDone={onCameraDone}
        onCompose={onCompose}
        sky={scene ?? null}
        canDraw={canDraw ?? true}
        onOpenLabel={onOpenLabel}
        encounter={encounter ?? null}
        sheets={sheets}
        refreshBattleMap={refreshBattleMap}
        chronicle={tabletopChronicle}
        visible={visible}
      />
    );
  }
  if (tab === "map") {
    return (
      <div className="space-y-3">
        <OverworldPanel
          campaignId={campaignId}
          genre={campaign?.gameSettings?.genre ?? "high_fantasy"}
          steersStory={steersStory}
          visible={visible}
        />
        <MapPanel
          campaignId={campaignId}
          locations={locations}
          steersStory={steersStory}
          mediaStatus={mediaStatus}
          genre={campaign?.gameSettings?.genre}
          scene={scene ?? null}
          inserts={theatreInserts}
        />
      </div>
    );
  }
  if (tab === "story") {
    return (
      <>
        <SubTabs tabs={storySubTabs} value={storySection} onChange={setStorySection} />
        <div key={storySection} className="motion-tab">
          {storySection === "facts" ? (
            <div className="reveal space-y-3">
              <PinsPanel campaignId={campaignId} version={pinsVersion} />
              <FactsPanel
                campaignId={campaignId}
                facts={facts}
                steersStory={steersStory}
                refreshFacts={refreshFacts}
              />
              <LorePanel campaignId={campaignId} steersStory={steersStory} isDm={adjudicates} members={members} />
            </div>
          ) : storySection === "quests" ? (
            <QuestsPanel campaignId={campaignId} steersStory={steersStory} refreshKey={questsVersion} />
          ) : storySection === "timeline" ? (
            <TimelinePanel campaignId={campaignId} refreshKey={chapters.length} />
          ) : storySection === "log" ? (
            <EventLog
              campaignId={campaignId}
              auditLog={auditLog}
              sheets={sheets}
              characterEvents={characterEvents}
              steersStory={steersStory}
            />
          ) : (
            <StoryPanel campaignId={campaignId} chapters={chapters} steersStory={steersStory} />
          )}
        </div>
      </>
    );
  }
  if (tab === "notes") {
    return (
      <NotesPanel
        campaignId={campaignId}
        notes={notes}
        members={members}
        meUserId={meUserId}
        steersStory={steersStory}
        refreshNotes={refreshNotes}
      />
    );
  }
  if (tab === "chat") {
    return (
      <div className="space-y-3">
        <DmWhisperPanel
          campaignId={campaignId}
          whispers={whispers}
          unread={whisperUnread}
          sheets={sheets}
          refreshWhispers={refreshWhispers}
        />
        <SideChatPanel
          campaignId={campaignId}
          members={members}
          meUserId={meUserId}
          threads={sideThreads}
          refreshSideChat={refreshSideChat}
          openThreadRequest={chatTarget}
          onOpenHandled={onChatTargetHandled}
        />
      </div>
    );
  }
  if (tab === "context" && steersStory) {
    return <ContextPanel campaignId={campaignId} />;
  }
  if (tab === "settings" && campaign) {
    return <SessionSettings campaign={campaign} isLead={isLead} steersStory={steersStory} isDm={adjudicates} />;
  }
  // Only reached when a tab's guard fails: battle with no map, or context
  // for a non-lead. Both are prevented upstream (useSessionTabs resets off
  // battle when the map goes; buildPanelTabs withholds context from players).
  // This used to render the audit log, which meant those cases silently
  // showed the wrong panel.
  return null;
}
