"use client";

import { BookMarked, BookOpen, Heart, ScrollText, Users } from "lucide-react";
import { useState } from "react";
import { DmConsolePanel } from "@/app/campaigns/[campaignId]/DmConsolePanel";
import { LeadPanel } from "@/app/campaigns/[campaignId]/LeadPanel";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import { BattleMapPanel } from "@/app/campaigns/[campaignId]/BattleMapPanel";
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
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Everything the side panel's content needs. SidePanel adds the rail's own
// props (the tab list, badges, the mobile switch) on top of these.
export type SidePanelRouterProps = {
  campaignId: string;
  sheets: CharacterSheet[];
  members: CampaignMember[];
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
  refreshBattleMap: () => Promise<void>;
  tab: PanelTab;
  // Bumped by the relationships_updated ephemeral; the Bonds panel refetches
  // its own scoped view when it changes.
  relationshipsVersion: number;
  // Gates the Bonds sub-tab. This used to withhold a top-level tab inside
  // buildPanelTabs; Bonds is a Party section now, so the flag has to reach
  // this component instead.
  relationshipsEnabled: boolean;
};

// Which panel the active tab shows. Every PanelTab has an explicit branch;
// the guards on dm, lead, battle and context are belt and braces over
// buildPanelTabs, so a stale selection never lands a player on a panel whose
// route will only ever answer 403.
export function SidePanelRouter({
  campaignId,
  sheets,
  members,
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
  refreshBattleMap,
  tab,
  relationshipsVersion,
  relationshipsEnabled,
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
  ];
  const storySubTabs: SubTabDef<StorySection>[] = [
    ["story", "Chapters", BookOpen],
    ["facts", "Facts", BookMarked],
    ["log", "Log", ScrollText],
  ];

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
        {partySection === "bonds" ? (
          <BondsPanel campaignId={campaignId} refreshKey={relationshipsVersion} />
        ) : (
          <>
            {encounter ? (
              <div className="mb-3">
                <EncounterPanel
                  campaignId={campaignId}
                  encounter={encounter}
                  steersStory={steersStory}
                  canEditOrder={adjudicates}
                  embedded
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
              companionsAvailable={
                campaign?.gameSettings
                  ? companionSlotsFree(
                      campaign.gameSettings,
                      members.length,
                      sheets
                        .filter((sheet) => sheet.isCompanion)
                        .map((sheet) => (sheet.companionKind === "guest" ? "guest" : "party")),
                    )
                  : false
              }
              companionBuildAvailable={
                campaign?.gameSettings
                  ? resolveCompanionMode(campaign.gameSettings, members.length) === "full" &&
                    sheets.filter((sheet) => sheet.isCompanion && sheet.companionKind !== "guest")
                      .length < campaign.gameSettings.maxCompanions
                  : false
              }
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
      </>
    );
  }
  if (tab === "battle" && battleMap) {
    return (
      <BattleMapPanel
        campaignId={campaignId}
        view={battleMap}
        canDirect={adjudicates}
        canFocusPing={steersStory}
        ping={mapPing ?? null}
        encounter={encounter ?? null}
        sheets={sheets}
        refreshBattleMap={refreshBattleMap}
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
        />
        <MapPanel
          campaignId={campaignId}
          locations={locations}
          steersStory={steersStory}
          mediaStatus={mediaStatus}
        />
      </div>
    );
  }
  if (tab === "story") {
    return (
      <>
        <SubTabs tabs={storySubTabs} value={storySection} onChange={setStorySection} />
        {storySection === "facts" ? (
          <div className="space-y-3">
            <PinsPanel campaignId={campaignId} version={pinsVersion} />
            <FactsPanel
              campaignId={campaignId}
              facts={facts}
              steersStory={steersStory}
              refreshFacts={refreshFacts}
            />
            <LorePanel campaignId={campaignId} steersStory={steersStory} />
          </div>
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
    return <SessionSettings campaign={campaign} isLead={isLead} steersStory={steersStory} />;
  }
  // Only reached when a tab's guard fails: battle with no map, or context
  // for a non-lead. Both are prevented upstream (useSessionTabs resets off
  // battle when the map goes; buildPanelTabs withholds context from players).
  // This used to render the audit log, which meant those cases silently
  // showed the wrong panel.
  return null;
}
