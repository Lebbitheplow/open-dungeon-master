"use client";

import {
  BookOpen,
  Crown,
  Gavel,
  Map as MapIcon,
  MessageSquareText,
  MessagesSquare,
  Gauge,
  Settings2,
  StickyNote,
  Swords,
  Users,
  type LucideIcon,
} from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { PlayerMapView } from "@/lib/battlemap/view";
import {
  visiblePanelTabs,
  type TableTabId,
  type TableTabInput,
} from "@/lib/dm/table-tabs";

// The id list is owned by src/lib/dm/table-tabs.ts, where the visibility
// rules are testable without React; this alias keeps the name the rest of
// the session code has always used.
export type PanelTab = TableTabId;

export type PanelTabDef = [PanelTab, string, LucideIcon, string];

// Second-level navigation inside a single tab. Facts and the audited log are
// both records of what the story has already made true, so they live under
// Story; bonds are grouped per character exactly like the roster, so they
// live under Party. Keeping them here rather than in the rail is what stops
// the header overflowing in a 320px panel.
export type StorySection = "story" | "facts" | "log";
export type PartySection = "party" | "bonds";

export type SubTabDef<T extends string> = [T, string, LucideIcon];

// The shared secondary row, deliberately quieter than the main rail: pills
// rather than the rail's icon-over-label cells, so it never reads as a second
// set of top-level tabs.
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: SubTabDef<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {tabs.map(([option, label, Icon]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
            value === option
              ? "border-amber-700 bg-amber-950/40 text-amber-200"
              : "border-stone-700 text-stone-400 hover:text-stone-200",
          )}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

// Which of the two session columns is visible below the lg breakpoint. On
// desktop both render side by side and this state has no visual effect.
export type MobileView = "chat" | "panel";

// Label, icon and rail tooltip per tab. Presentation only: which of these
// a given viewer sees, and in what order, is visiblePanelTabs's decision.
const TAB_PRESENTATION: Record<PanelTab, [string, LucideIcon, string]> = {
  dm: [
    "DM",
    Gavel,
    "Everything waiting on you, and every ruling the engine can make on your say-so.",
  ],
  lead: [
    "Lead",
    Crown,
    "Steer the table: the floor, notes waiting on you, invites and the lead seat.",
  ],
  party: [
    "Party",
    Users,
    "Character sheets, HP and conditions for the whole party, and their bonds with the people they have met.",
  ],
  battle: ["Battle", Swords, "The tactical battle map. Move your token on your turn."],
  map: ["Map", MapIcon, "The scene map and discovered locations."],
  story: [
    "Story",
    BookOpen,
    "Chapters and the tale so far, the world-state record, and the audited log of rolls and stat changes.",
  ],
  notes: ["Notes", StickyNote, "Suggest story notes; the party lead approves them."],
  chat: ["Chat", MessagesSquare, "Side chat between players. The DM does not see it."],
  context: [
    "Context",
    Gauge,
    "What the DM was actually sent last turn, and anything the budget cut.",
  ],
  settings: ["Setup", Settings2, "Campaign settings, invites and game toggles."],
};

// Single source of truth for the panel tab list, shared by the desktop rail
// strip and the mobile bottom bar. The gating flags are documented on
// TableTabInput (src/lib/dm/table-tabs.ts).
export function buildPanelTabs(input: TableTabInput): PanelTabDef[] {
  return visiblePanelTabs(input).map((id) => [id, ...TAB_PRESENTATION[id]]);
}

// The lead tab is the one place in the rail that is not the DM's gold: the
// same ember the composer's Direct pill wears, so the two halves of "the lead
// steering the table" read as one thing. The classes are the icon-rail
// recipes from src/lib/ui.tsx, so the bottom bar and the docked IconRail
// look like the same control.
export function tabAccentClass(tab: PanelTab, active: boolean): string {
  if (!active) {
    return "";
  }
  return tab === "lead" ? ui.railCellActiveEmber : ui.railCellActive;
}

// The count pill on a tab. Gold everywhere except the lead tab, where it
// matches the ember accent above.
export function tabBadgeClass(tab: PanelTab): string {
  return cn(
    "absolute right-1.5 top-1 rounded-full bg-gradient-to-b px-1 text-[9px] font-semibold",
    tab === "lead"
      ? "from-ember-300 to-ember-500 text-stone-950 shadow-glow-ember"
      : "from-amber-300 to-amber-500 text-amber-950 shadow-glow-gold",
  );
}

// Owns which panel tab is active (shared by rail and mobile) and which column
// shows below lg. The auto-jumps mirror the old SidePanel behavior and pull
// mobile users onto the panel column too: an incoming chat target opens the
// chat tab, combat starting opens the battle map.
export function useSessionTabs({
  chatTarget,
  battleMap,
  isLead,
}: {
  chatTarget: string | null;
  battleMap?: PlayerMapView | null;
  // The lead tab disappears when the seat is handed to someone else, so a
  // stale selection falls back exactly as battle does when the map goes.
  isLead: boolean;
}) {
  const [panelTab, setPanelTab] = useState<PanelTab>("party");
  const [mobileView, setMobileView] = useState<MobileView>("chat");

  // "Message" on a party card jumps to the chat tab; SideChatPanel opens the
  // 1:1 thread from the same request. State-from-props during render, per
  // React's "adjusting state when a prop changes" pattern.
  const [seenChatTarget, setSeenChatTarget] = useState<string | null>(null);
  if (chatTarget && chatTarget !== seenChatTarget) {
    setSeenChatTarget(chatTarget);
    setPanelTab("chat");
    setMobileView("panel");
  }

  // Combat starting jumps to the battle map; the tab itself disappears when
  // the encounter ends, so fall back off it.
  const [seenMapId, setSeenMapId] = useState<string | null>(null);
  if (battleMap && battleMap.mapId !== seenMapId) {
    setSeenMapId(battleMap.mapId);
    setPanelTab("battle");
    setMobileView("panel");
  }
  if (!battleMap && panelTab === "battle") {
    setPanelTab("party");
  }
  if (!isLead && panelTab === "lead") {
    setPanelTab("party");
  }

  return { panelTab, setPanelTab, mobileView, setMobileView };
}

// Mobile-only navigation: the main game chat ("Table") plus every panel tab,
// each filling the screen when selected. Hidden at lg and up.
function BottomTabBarInner({
  tabs,
  mobileView,
  panelTab,
  onSelectChat,
  onSelectPanel,
  chatUnread,
  pendingCount,
  storyDue,
  steersStory,
}: {
  tabs: PanelTabDef[];
  mobileView: MobileView;
  panelTab: PanelTab;
  onSelectChat: () => void;
  onSelectPanel: (tab: PanelTab) => void;
  chatUnread: number;
  pendingCount: number;
  // The DM has story to write down (src/lib/dm/beat-cadence.ts).
  storyDue: boolean;
  // Pending notes are the lead's to approve only while they steer the
  // story; at a human-DM table the count is the DM's and the lead tab stays
  // quiet.
  steersStory: boolean;
}) {
  return (
    <nav className="glass flex items-stretch gap-1 overflow-x-auto border-t border-stone-700/40 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 lg:hidden">
      <button
        type="button"
        onClick={onSelectChat}
        className={cn(ui.railCell, "flex-1", mobileView === "chat" && ui.railCellActive)}
      >
        <MessageSquareText className="size-5" />
        <span className="eyebrow text-[9px] leading-none">Table</span>
      </button>
      {tabs.map(([value, label, Icon]) => {
        const active = mobileView === "panel" && panelTab === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelectPanel(value)}
            className={cn(ui.railCell, "flex-1", tabAccentClass(value, active))}
          >
            <Icon
              className={cn("size-5", value === "chat" && chatUnread > 0 && "animate-wiggle")}
            />
            <span className="eyebrow text-[9px] leading-none">{label}</span>
            {value === "chat" && chatUnread > 0 ? (
              <span className="absolute left-1.5 top-1 size-1.5 rounded-full bg-red-500" />
            ) : null}
            {value === "dm" && storyDue ? (
              <span className="absolute right-1.5 top-1 size-1.5 rounded-full bg-amber-400" />
            ) : null}
            {(value === "notes" || (value === "lead" && steersStory)) && pendingCount ? (
              <span className={tabBadgeClass(value)}>{pendingCount}</span>
            ) : null}
            {value === "chat" && chatUnread ? (
              <span className={tabBadgeClass(value)}>{chatUnread}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export const BottomTabBar = memo(BottomTabBarInner);
