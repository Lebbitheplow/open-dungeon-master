"use client";

import { playingSheet, turnFromEncounter, turnHudBudget } from "@/lib/battlemap/hand-table";
import { initiativeCharacter } from "@/lib/player-characters";
import { BookMarked, BookOpen, Flag, Heart, History, ListChecks, ScrollText, ShoppingBag, Users } from "lucide-react";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import { ConsoleOutcomeBanner } from "@/app/campaigns/[campaignId]/ConsoleOutcomeBanner";
import type { FxEvent } from "@/lib/battlemap/fx-plan";
import type { CameraEvent, SceneState } from "@/lib/scene/state";
import type { MapLabel } from "@/lib/battlemap/scene";
import { EncounterPanel } from "@/app/campaigns/[campaignId]/EncounterPanel";
import type { DepartingSheet } from "@/app/campaigns/[campaignId]/departing";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import { segmentsOf, speakersIn } from "@/lib/dm/speech";
import type { CastMember } from "@/lib/dm/cast";
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
import type { PartyState } from "@/lib/dm/party-logic";
import { allDelegations, type DmCover } from "@/lib/dm/delegation";
import type { Floor } from "@/lib/db/campaigns";
import type { Chapter } from "@/lib/db/chapters";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { Note } from "@/lib/db/notes";
import type { WorldFact } from "@/lib/db/facts";
import type { DmWhisper, InboxWhisper } from "@/lib/db/dm-whispers";
import type { SideThread } from "@/lib/db/side-chat";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { MapPing } from "@/lib/dm/board-logic";
import { companionSlotsFree, lastingCompanionBlock, resolveCompanionMode } from "@/lib/schemas/game-settings";
import { hasHumanDm, partySlotCount } from "@/lib/dm/viewer";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { MarketRequest } from "@/lib/dm/table-tabs";
import type { LeadPanel as LeadPanelComponent } from "@/app/campaigns/[campaignId]/LeadPanel";
import type { SessionSettings as SessionSettingsComponent } from "@/app/campaigns/[campaignId]/SessionSettings";
import { PanelLoading, panels } from "@/app/campaigns/[campaignId]/side-panel-loaders";
import { mayWritePartyBackstory } from "@/lib/dm/party-story";

// Every panel but the party roster (the tab a table opens on) is its own
// download, fetched when its tab is first opened or, sooner, when the
// browser is idle after the table is up (side-panel-loaders.ts). Each waits
// behind its own Suspense, so a section's tabs stay put while it arrives.
const {
  BattleMapPanel, BondsPanel, ContextPanel, DmConsolePanel, DmInboxPanel, DmWhisperPanel, EventLog, FactionsPanel,
  FactsPanel, LeadPanel, LorePanel, MapPanel, MarketPanel, NotesPanel, OverworldPanel, PartyAtlasPanel, PinsPanel, QuestsPanel,
  SessionSettings, SideChatPanel, StoryPanel, TimelinePanel, WorldForgePanel,
} = panels;

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
  // The owner or the DM proper, who may end the campaign (Setup tab).
  canEndCampaign?: boolean;
  // The chat, for the console's queue of unanswered player actions.
  messages: CampaignMessage[];
  dmIntents: Array<{ messageId: string; userId: string; characterId: string; seq: number }>;
  // Who may speak right now: the console's floor control reads the mode,
  // the lead's desk reads the whole thing (who is spotlit, who has answered).
  floor: Floor;
  // Story the DM has already written down, newest first.
  beats: DmBeat[];
  // The stream's director flag, for the armed banner on the lead's desk.
  directorArm?: Parameters<typeof LeadPanelComponent>[0]["directorArm"];
  // The party is coordinating a plan (issue 254).
  coordinating?: boolean;
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
  dmInbox: InboxWhisper[];
  refreshWhispers: () => Promise<void>;
  chatTarget: string | null;
  onChatTargetHandled: () => void;
  onMessageUser: (userId: string) => void;
  mediaStatus: Record<string, MediaStatus>;
  inviteCode?: string;
  midGameJoinOpen?: boolean;
  // The settings panel's shape plus the two DM seats, which the lead's desk
  // needs to keep them out of the "make lead" list.
  campaign?: Parameters<typeof SessionSettingsComponent>[0]["campaign"] & {
    dmUserId?: string | null;
    assistantDmUserId?: string | null;
    // The party record, for the travel formation (issue 230).
    party?: PartyState;
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
  // Lasting companions whose sheet just went (issue 503): the Party panel's
  // Gone list.
  departingSheets?: DepartingSheet[];
  factionsVersion?: number;
  // Bumped when the world changed (world_updated, records_changed), so the
  // World tab reads it again.
  worldVersion?: number;
  // Bumped on lore_updated, so the lore list reads itself again.
  loreVersion?: number;
  shopsVersion?: number;
  // A Browse wares pressed in the chat: open the Market on that shop.
  marketRequest?: MarketRequest | null;
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
  // Switches the side panel to another tab (SidePanel's rail), for a panel
  // that points somewhere else: the Party panel's way to the Setup tab.
  onOpenTab?: (tab: PanelTab) => void;
};

// Which panel the active tab shows. Every PanelTab has an explicit branch;
// the guards on dm, lead, battle, world and context are belt and braces over
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
  dmInbox,
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
  departingSheets = [],
  factionsVersion = 0,
  worldVersion = 0,
  loreVersion = 0,
  shopsVersion = 0,
  marketRequest = null,
  coins = null,
  activeSheetId = "",
  questsVersion,
  relationshipsEnabled,
  visible = true,
  onOpenTab,
  adjudicates,
  canEndCampaign = false,
  messages,
  dmIntents,
  floor,
  beats,
  directorArm,
  coordinating = false,
}: SidePanelRouterProps) {
  // Which section of Party and Story is showing. Local state: nothing outside
  // this panel reads or sets them.
  const [partySection, setPartySection] = useState<PartySection>("party");
  const [storySection, setStorySection] = useState<StorySection>("story");
  // A Browse wares from the chat turns Party to its Market, once per press.
  // State-from-props during render, as useSessionTabs takes a chat target.
  const [seenMarketAt, setSeenMarketAt] = useState(0);
  if (marketRequest && marketRequest.at !== seenMarketAt) {
    setSeenMarketAt(marketRequest.at);
    setPartySection("market");
  }

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
      : speakersIn(segmentsOf(latest.content, latest.speech.filter((entry) => entry.speaker.kind === "npc")));
    return { speakers, cast, messageId: latest.id };
  }, [campaign?.gameSettings?.presentation, messages, cast]);
  const partySize = partySlotCount(
    dmSeats,
    members.map((member) => member.userId),
  );

  const tab: PanelTab = stageBoard && rawTab === "battle" ? "party" : rawTab;
  if (tab === "dm" && adjudicates) {
    return (
      <Suspense fallback={<PanelLoading />}>
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
</Suspense>
    );
  }
  if (tab === "lead" && isLead && campaign) {
    // useSessionTabs falls off this tab when the seat moves, but a stale
    // selection must not show a player the invite code.
    return (
      <Suspense fallback={<PanelLoading />}>
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
        coordinating={coordinating}
      />
</Suspense>
    );
  }
  if (tab === "party") {
    return (
      <>
        {/* With the board on the stage the Battle tab shows the party: a
            fight the console just started leaves its result here. */}
        {rawTab === "battle" && adjudicates ? <ConsoleOutcomeBanner campaignId={campaignId} /> : null}
        {partySubTabs.length > 1 ? (
          <SubTabs tabs={partySubTabs} value={partySection} onChange={setPartySection} />
        ) : null}
        <div key={partySection} className="motion-tab">
          {partySection === "bonds" ? (
            <Suspense fallback={<PanelLoading />}>
              <BondsPanel campaignId={campaignId} refreshKey={relationshipsVersion} sheets={sheets} meUserId={meUserId} />
            </Suspense>
          ) : partySection === "factions" ? (
            <Suspense fallback={<PanelLoading />}>
              <FactionsPanel campaignId={campaignId} steersStory={steersStory} refreshKey={factionsVersion} />
            </Suspense>
          ) : partySection === "market" ? (
            <Suspense fallback={<PanelLoading />}>
            <MarketPanel
              campaignId={campaignId}
              steersStory={steersStory}
              isDm={adjudicates}
              mySheet={playingSheet(sheets, meUserId, activeSheetId)}

              refreshKey={shopsVersion}
              coins={coins}
              focus={marketRequest}
              onAskKeeper={onCompose}
            />
            </Suspense>
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
                departing={departingSheets}
                goneRefreshKey={relationshipsVersion}
                party={campaign?.party}
                arrangesFormation={isLead || adjudicates}
                partyStory={
                  campaign?.gameSettings
                    ? {
                        canWrite: mayWritePartyBackstory({
                          isLead,
                          holdsDmSeat: meUserId === campaign.dmUserId || meUserId === campaign.assistantDmUserId,
                          hasCharacter: sheets.some((sheet) => sheet.userId === meUserId && !sheet.isCompanion),
                        }),
                      }
                    : undefined
                }
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
                encounter={encounter ?? null}
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
                companionBlock={
                  campaign?.gameSettings
                    ? lastingCompanionBlock(
                        campaign.gameSettings,
                        partySize,
                        sheets.filter((sheet) => sheet.isCompanion && sheet.companionKind !== "guest").length,
                        humanDmTable,
                      )
                    : null
                }
                onOpenSettings={onOpenTab ? () => onOpenTab("settings") : undefined}
                humanDmTable={humanDmTable}
                romanceNotes={
                  humanDmTable &&
                  adjudicates &&
                  campaign?.gameSettings?.relationships !== "off" &&
                  campaign?.gameSettings?.romance !== "off"
                }
                companionGenre={campaign?.gameSettings?.genre}
                companionWorldPack={campaign?.gameSettings?.worldPack}
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
    // The turn's character when it is this player's (their own, or a
    // companion they command), else the one being played.
    const playing = initiativeCharacter(sheets, meUserId, encounter?.acting?.id) ?? playingSheet(sheets, meUserId, activeSheetId);
    return (
      // board-dock: the side panel and the phone hold the board in a fixed
      // window too, so its header and footer stay on screen (issue 87).
      <div className="board-dock">
      {adjudicates ? <ConsoleOutcomeBanner campaignId={campaignId} /> : null}
      <Suspense fallback={<PanelLoading />}>
      <BattleMapPanel
        campaignId={campaignId}
        meUserId={meUserId}
        activeSheetId={activeSheetId}
        multiCharacter={campaign?.gameSettings?.multiCharacter ?? "off"}
        view={battleMap}

        intents={battleMap.intents}
        genre={campaign?.gameSettings?.genre ?? null}
        turnBudget={
          // The character being played, as the Hand reads it
          // (src/lib/battlemap/hand-table.ts): any owned sheet's turn put
          // the other character's budget on the board after Play as. The
          // count is the main board's (SessionView.tsx): drawn from the
          // turn's start, before anything is spent, with a spent reaction
          // from reactionsUsed and an action Haste or Action Surge leave.
          playing && encounter
            ? turnHudBudget(turnFromEncounter(encounter, playing, { myTurn: encounter.turn?.ownerId === playing.id }))
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
      </Suspense>
      </div>
    );
  }
  if (tab === "map") {
    return (
      <Suspense fallback={<PanelLoading />}>
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
        {/* The Atlas maps the DM has shown to the party (WorldForge). */}
        <PartyAtlasPanel campaignId={campaignId} refreshKey={worldVersion} />
      </div>
      </Suspense>
    );
  }
  if (tab === "story") {
    return (
      <>
        <SubTabs tabs={storySubTabs} value={storySection} onChange={setStorySection} />
        <div key={storySection} className="motion-tab">
          <Suspense fallback={<PanelLoading />}>
          {storySection === "facts" ? (
            <div className="reveal space-y-3">
              <PinsPanel campaignId={campaignId} version={pinsVersion} />
              <FactsPanel
                campaignId={campaignId}
                facts={facts}
                steersStory={steersStory}
                refreshFacts={refreshFacts}
              />
              <LorePanel campaignId={campaignId} steersStory={steersStory} isDm={adjudicates} members={members} refreshKey={loreVersion} />
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
          </Suspense>
        </div>
      </>
    );
  }
  if (tab === "notes") {
    return (
      <Suspense fallback={<PanelLoading />}>
      <NotesPanel
        campaignId={campaignId}
        notes={notes}
        members={members}
        meUserId={meUserId}
        steersStory={steersStory}
        refreshNotes={refreshNotes}
      />
      </Suspense>
    );
  }
  if (tab === "chat") {
    return (
      <Suspense fallback={<PanelLoading />}>
      <div className="space-y-3">
        {adjudicates && humanDmTable ? (
          // The DM seat's side of the private line: what the players sent,
          // answered from here (the player's own card would whisper to
          // themselves).
          <DmInboxPanel campaignId={campaignId} inbox={dmInbox} refreshWhispers={refreshWhispers} />
        ) : (
          <DmWhisperPanel
            campaignId={campaignId}
            whispers={whispers}
            unread={whisperUnread}
            sheets={sheets}
            refreshWhispers={refreshWhispers}
          />
        )}
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
      </Suspense>
    );
  }
  if (tab === "world" && steersStory) {
    // The campaign's own copy of its world (the records the import copied
    // from a workshop, or written here), through the routes that answer
    // only story authority. A faction entry's change arrives as
    // factions_updated, so that count refreshes it too.
    return (
      <Suspense fallback={<PanelLoading />}>
        <WorldForgePanel campaignId={campaignId} at="table" canShowHandouts={adjudicates} refreshKey={worldVersion + factionsVersion} />
      </Suspense>
    );
  }
  if (tab === "context" && steersStory) {
    return (
      <Suspense fallback={<PanelLoading />}>
        <ContextPanel campaignId={campaignId} />
      </Suspense>
    );
  }
  if (tab === "settings" && campaign) {
    return (
      <Suspense fallback={<PanelLoading />}>
        <SessionSettings
          campaign={campaign}
          isLead={isLead}
          steersStory={steersStory}
          isDm={adjudicates}
          canEnd={canEndCampaign}
          lastingCompanions={
            campaign.gameSettings
              ? resolveCompanionMode(campaign.gameSettings, partySize, humanDmTable) === "full" ||
                sheets.some((sheet) => sheet.isCompanion && sheet.companionKind !== "guest" && !sheet.summon)
              : false
          }
        />
      </Suspense>
    );
  }
  // Only reached when a tab's guard fails: battle with no map, or context
  // for a non-lead. Both are prevented upstream (useSessionTabs resets off
  // battle when the map goes; buildPanelTabs withholds context from players).
  // This used to render the audit log, which meant those cases silently
  // showed the wrong panel.
  return null;
}
