"use client";

import {
  BookOpen,
  Map as MapIcon,
  MessageSquareText,
  MessagesSquare,
  ScrollText,
  Settings2,
  StickyNote,
  Swords,
  Users,
  type LucideIcon,
} from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import type { PlayerMapView } from "@/lib/battlemap/view";

export type PanelTab =
  | "party"
  | "battle"
  | "map"
  | "story"
  | "notes"
  | "chat"
  | "log"
  | "settings";

export type PanelTabDef = [PanelTab, string, LucideIcon, string];

// Which of the two session columns is visible below the lg breakpoint. On
// desktop both render side by side and this state has no visual effect.
export type MobileView = "chat" | "panel";

// Single source of truth for the panel tab list, shared by the desktop rail
// strip and the mobile bottom bar.
export function buildPanelTabs({
  hasBattleMap,
  mapsEnabled,
  hasSettings,
}: {
  hasBattleMap: boolean;
  mapsEnabled: boolean;
  hasSettings: boolean;
}): PanelTabDef[] {
  return [
    ["party", "Party", Users, "Character sheets, HP and conditions for the whole party."],
    ...(hasBattleMap
      ? ([["battle", "Battle", Swords, "The tactical battle map. Move your token on your turn."]] as PanelTabDef[])
      : []),
    ...(mapsEnabled
      ? ([["map", "Map", MapIcon, "The scene map and discovered locations."]] as PanelTabDef[])
      : []),
    ["story", "Story", BookOpen, "Chapters and the tale so far."],
    ["notes", "Notes", StickyNote, "Suggest story notes; the party lead approves them."],
    ["chat", "Chat", MessagesSquare, "Side chat between players. The DM does not see it."],
    ["log", "Log", ScrollText, "Dice rolls and DM stat changes, audited."],
    ...(hasSettings
      ? ([["settings", "Setup", Settings2, "Campaign settings, invites and game toggles."]] as PanelTabDef[])
      : []),
  ];
}

// Owns which panel tab is active (shared by rail and mobile) and which column
// shows below lg. The auto-jumps mirror the old SidePanel behavior and pull
// mobile users onto the panel column too: an incoming chat target opens the
// chat tab, combat starting opens the battle map.
export function useSessionTabs({
  chatTarget,
  battleMap,
}: {
  chatTarget: string | null;
  battleMap?: PlayerMapView | null;
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
}: {
  tabs: PanelTabDef[];
  mobileView: MobileView;
  panelTab: PanelTab;
  onSelectChat: () => void;
  onSelectPanel: (tab: PanelTab) => void;
  chatUnread: number;
  pendingCount: number;
}) {
  return (
    <nav className="glass flex items-stretch gap-1 overflow-x-auto border-t border-stone-700/40 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 lg:hidden">
      <button
        type="button"
        onClick={onSelectChat}
        className={cn(
          "relative flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-lg py-2 transition-all duration-150 ease-snap",
          mobileView === "chat"
            ? "bg-amber-400/10 text-amber-300 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)]"
            : "text-stone-500 hover:bg-stone-900/60 hover:text-stone-300",
        )}
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
            className={cn(
              "relative flex min-w-[3.25rem] flex-1 flex-col items-center gap-1 rounded-lg py-2 transition-all duration-150 ease-snap",
              active
                ? "bg-amber-400/10 text-amber-300 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)]"
                : "text-stone-500 hover:bg-stone-900/60 hover:text-stone-300",
            )}
          >
            <Icon
              className={cn("size-5", value === "chat" && chatUnread > 0 && "animate-wiggle")}
            />
            <span className="eyebrow text-[9px] leading-none">{label}</span>
            {value === "chat" && chatUnread > 0 ? (
              <span className="absolute left-1.5 top-1 size-1.5 rounded-full bg-red-500" />
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
          </button>
        );
      })}
    </nav>
  );
}

export const BottomTabBar = memo(BottomTabBarInner);
