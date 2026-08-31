"use client";

import {
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Heart,
  Link as LinkIcon,
  ScrollText,
  UserPlus,
  Users,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { DmConsolePanel } from "@/app/campaigns/[campaignId]/DmConsolePanel";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import { Tooltip } from "@/components/ui/Tooltip";
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
  type PanelTabDef,
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

// Two widths only: the default rail and a roomier one. Per-browser
// localStorage via useSyncExternalStore, same pattern as useChatChime:
// server render is narrow and the client snapshot takes over at hydration.
const WIDE_KEY = "odm_side_panel_wide";
const WIDE_EVENT = "odm-side-panel-width";

function subscribeWide(callback: () => void) {
  window.addEventListener(WIDE_EVENT, callback);
  return () => window.removeEventListener(WIDE_EVENT, callback);
}

function readWide() {
  return window.localStorage.getItem(WIDE_KEY) === "1";
}

function setWide(wide: boolean) {
  window.localStorage.setItem(WIDE_KEY, wide ? "1" : "0");
  window.dispatchEvent(new Event(WIDE_EVENT));
}

// The tab rail scrolls sideways. There are up to eleven tabs and the panel is
// 320px wide, and the buttons cannot shrink below their label (a flex item's
// min-width is auto), so without a scroll container the row simply overflowed
// and the trailing tabs, Context and Setup, were clipped with no way to reach
// them. A trackpad or a tilt wheel scrolls it, but a plain two-button mouse
// cannot, so each overflowing edge also gets a click target. The arrows are
// only rendered when there is somewhere to go in that direction, which is why
// they double as the "there is more" hint the old static fade used to give.
function TabRail({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [reach, setReach] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A pixel of slack: fractional layout widths mean scrollLeft rarely lands
    // exactly on the maximum, and without it the right arrow never clears.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setReach((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // scrollWidth changes when the tab list changes (the DM and Context tabs are
  // conditional) and clientWidth changes when the panel is widened. Neither is
  // a scroll event, so re-measure after every render as well.
  useEffect(measure);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  function nudge(direction: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.7, 80), behavior: "smooth" });
  }

  return (
    <div className="relative hidden border-b border-stone-700/50 lg:block">
      <div ref={scroller} className="flex items-stretch gap-1 overflow-x-auto px-2 py-2">
        {children}
      </div>
      {reach.left ? (
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Scroll tabs left"
          className="absolute inset-y-0 left-0 flex w-7 items-center justify-start bg-gradient-to-r from-stone-950 via-stone-950/90 to-transparent text-stone-500 transition-colors hover:text-amber-300"
        >
          <ChevronLeft className="size-4" />
        </button>
      ) : null}
      {reach.right ? (
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Scroll tabs right"
          className="absolute inset-y-0 right-0 flex w-7 items-center justify-end bg-gradient-to-l from-stone-950 via-stone-950/90 to-transparent text-stone-500 transition-colors hover:text-amber-300"
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

// The session's panel column: party sheets, the current area map, story
// chapters, table notes, and the stat-change log. On desktop it is the tabbed
// right rail; below lg it fills the screen when the bottom tab bar selects a
// panel. Tab state lives in SessionView (SessionTabs) so the mobile bottom
// bar and this rail stay in sync.
function SidePanelInner({
  campaignId,
  sheets,
  members,
  meUserId,
  steersStory,
  isLead,
  leadUserId,
  canTransferLead,
  spotlightUserIds,
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
  tabs,
  tab,
  onTabChange,
  pendingCount,
  chatUnread,
  mobileVisible,
  relationshipsVersion,
  relationshipsEnabled,
  adjudicates,
  messages,
  dmIntents,
  floorMode,
  beats,
  storyDue,
}: {
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
  // Who may speak right now, for the console's floor control.
  floorMode: "open" | "hold" | "spotlight" | "initiative";
  // Story the DM has already written down, newest first.
  beats: DmBeat[];
  // The quiet half of the story-capture nudge: a dot on the DM tab. The loud
  // half is the banner above the composer (src/lib/dm/beat-cadence.ts).
  storyDue: boolean;
  leadUserId: string;
  canTransferLead: boolean;
  spotlightUserIds: string[];
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
  campaign?: Parameters<typeof SessionSettings>[0]["campaign"];
  // Assisted mode: the stretch of answers the DM handed to the AI. Separate
  // from `campaign` because that shape carries only what the settings panel edits.
  dmCover?: DmCover | null;
  encounter?: PublicEncounter | null;
  battleMap?: PlayerMapView | null;
  mapPing?: MapPing | null;
  refreshBattleMap: () => Promise<void>;
  tabs: PanelTabDef[];
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  pendingCount: number;
  chatUnread: number;
  mobileVisible: boolean;
  // Bumped by the relationships_updated ephemeral; the Bonds panel refetches
  // its own scoped view when it changes.
  relationshipsVersion: number;
  // Gates the Bonds sub-tab. This used to withhold a top-level tab inside
  // buildPanelTabs; Bonds is a Party section now, so the flag has to reach
  // this component instead.
  relationshipsEnabled: boolean;
}) {
  const [inviteCopied, setInviteCopied] = useState(false);
  // Which section of Party and Story is showing. Local state: nothing outside
  // this panel reads or sets them, and memo is unaffected by internal state.
  const [partySection, setPartySection] = useState<PartySection>("party");
  const [storySection, setStorySection] = useState<StorySection>("story");
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);

  const partySubTabs: SubTabDef<PartySection>[] = [
    ["party", "Roster", Users],
    ...(relationshipsEnabled ? ([["bonds", "Bonds", Heart]] as SubTabDef<PartySection>[]) : []),
  ];
  const storySubTabs: SubTabDef<StorySection>[] = [
    ["story", "Chapters", BookOpen],
    ["facts", "Facts", BookMarked],
    ["log", "Log", ScrollText],
  ];

  // Lead-only mid-game invite controls, shown on the Party tab.
  async function toggleMidGameJoin() {
    await fetch(`/api/campaigns/${campaignId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ midGameJoinOpen: !midGameJoinOpen }),
    });
  }

  async function copyInviteLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 1500);
  }

  return (
    <aside
      className={cn(
        "shrink-0 flex-col bg-gradient-to-b from-stone-950/70 to-stone-950/30 lg:flex lg:border-l lg:border-stone-700/50 lg:transition-[width] lg:duration-200",
        mobileVisible ? "flex w-full min-w-0" : "hidden",
        wide ? "lg:w-[26rem]" : "lg:w-80",
      )}
    >
      <TabRail>
        <Tooltip content={wide ? "Narrow the panel" : "Widen the panel"} side="bottom">
          <button
            type="button"
            onClick={() => setWide(!wide)}
            className="flex shrink-0 items-center rounded-lg px-1 text-stone-500 transition-colors hover:bg-stone-900/60 hover:text-stone-300"
          >
            {wide ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </Tooltip>
        {tabs.map(([value, label, Icon, tip]) => (
          <Tooltip key={value} content={tip} side="bottom">
          <button
            type="button"
            onClick={() => onTabChange(value)}
            className={cn(
              "relative flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-lg py-2 transition-all duration-150 ease-snap",
              tab === value
                ? "bg-amber-400/10 text-amber-300 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)]"
                : "text-stone-500 hover:bg-stone-900/60 hover:text-stone-300",
            )}
          >
            <Icon
              className={cn("size-4", value === "chat" && chatUnread > 0 && "animate-wiggle")}
            />
            <span className="eyebrow text-[9px] leading-none">{label}</span>
            {value === "chat" && chatUnread > 0 ? (
              <span className="absolute left-1.5 top-1 size-1.5 rounded-full bg-red-500" />
            ) : null}
            {value === "dm" && storyDue ? (
              <span className="absolute right-1.5 top-1 size-1.5 rounded-full bg-amber-400" />
            ) : null}
            {value === "notes" && pendingCount ? (
              <span className="absolute right-1.5 top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold text-amber-950 shadow-glow-gold">
                {pendingCount}
              </span>
            ) : null}
            {value === "chat" && chatUnread ? (
              <span className="absolute right-1.5 top-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] font-semibold text-amber-950 shadow-glow-gold">
                {chatUnread}
              </span>
            ) : null}
            {tab === value ? (
              <span className="absolute -bottom-[9px] h-px w-8 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent" />
            ) : null}
          </button>
          </Tooltip>
        ))}
      </TabRail>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto w-full max-w-2xl lg:max-w-none">
        {tab === "dm" && adjudicates ? (
          // Belt and braces, like the context tab below: buildPanelTabs
          // already withholds this from anyone without the DM seat, and a
          // stale selection must not land a player on a console whose route
          // will only ever answer 403.
          <DmConsolePanel
            campaignId={campaignId}
            sheets={sheets}
            encounter={encounter ?? null}
            messages={messages}
            intents={dmIntents}
            floorMode={floorMode}
            beats={beats}
            delegations={allDelegations(
              campaign?.gameSettings?.dmMode,
              campaign?.gameSettings?.dmAssist,
            )}
            cover={dmCover ?? null}
            variantRules={{
              powerfulCritical:
                campaign?.gameSettings?.variantRules?.powerfulCritical ?? false,
              criticalDamageMods:
                campaign?.gameSettings?.variantRules?.criticalDamageMods ?? false,
            }}
          />
        ) : tab === "party" ? (
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
          {isLead && inviteCode ? (
            <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-400">
                <UserPlus className="size-3.5" /> New players
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMidGameJoin}
                  title="Allow new players to join with the invite code mid-game"
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    midGameJoinOpen
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  Joining {midGameJoinOpen ? "open" : "closed"}
                </button>
                {midGameJoinOpen ? (
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    title="Copy the invite link"
                    className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
                  >
                    {inviteCopied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <LinkIcon className="size-3.5" />
                    )}
                    {inviteCode}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <PartyPanel
            sheets={sheets}
            meUserId={meUserId}
            spotlightUserIds={spotlightUserIds}
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
              const levels = sheets.filter((sheet) => !sheet.isCompanion).map((sheet) => sheet.level);
              return levels.length
                ? Math.max(1, Math.round(levels.reduce((sum, n) => sum + n, 0) / levels.length))
                : (campaign?.startingLevel ?? 1);
            })()}
            embedded
          />
          </>
          )}
          </>
        ) : tab === "battle" && battleMap ? (
          <BattleMapPanel
            campaignId={campaignId}
            view={battleMap}
            canDirect={adjudicates}
            ping={mapPing ?? null}
            encounter={encounter ?? null}
            sheets={sheets}
            refreshBattleMap={refreshBattleMap}
          />
        ) : tab === "map" ? (
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
        ) : tab === "story" ? (
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
        ) : tab === "notes" ? (
          <NotesPanel
            campaignId={campaignId}
            notes={notes}
            members={members}
            meUserId={meUserId}
            steersStory={steersStory}
            refreshNotes={refreshNotes}
          />
        ) : tab === "chat" ? (
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
        ) : tab === "context" && steersStory ? (
          // Belt and braces: buildPanelTabs already withholds this tab from
          // players, but a stale tab selection must not land them on a panel
          // whose route will only ever answer 403.
          <ContextPanel campaignId={campaignId} />
        ) : tab === "settings" && campaign ? (
          <SessionSettings campaign={campaign} isLead={isLead} />
        ) : (
          // Every PanelTab above has an explicit branch, so this is only
          // reached when a tab's guard fails: battle with no map, or context
          // for a non-lead. Both are already prevented upstream (useSessionTabs
          // resets off battle when the map goes; buildPanelTabs withholds
          // context from players). This used to render the audit log, which
          // meant those cases silently showed the wrong panel.
          null
        )}
        </div>
      </div>
    </aside>
  );
}

// Memoized: the session view re-renders on every streamed DM token, and
// this panel's props are unchanged during narration.
export const SidePanel = memo(SidePanelInner);
