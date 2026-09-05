"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  SidePanelRouter,
  type SidePanelRouterProps,
} from "@/app/campaigns/[campaignId]/SidePanelRouter";
import type { PanelTab, PanelTabDef } from "@/app/campaigns/[campaignId]/SessionTabs";

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

// The session's context column: party sheets, the current area map, story
// chapters, table notes, and the stat-change log. From lg up it is docked
// beside the chat with a vertical icon rail on its outer edge, so the story
// never disappears behind a panel and every tab is one click away without
// a sideways scroll. Below lg it fills the screen when the bottom tab bar
// selects a panel, and the bottom bar is the rail. Tab state lives in
// SessionView (SessionTabs) so the two rails stay in sync.
function SidePanelInner({
  tabs,
  onTabChange,
  pendingCount,
  chatUnread,
  mobileVisible,
  storyDue,
  ...content
}: SidePanelRouterProps & {
  tabs: PanelTabDef[];
  onTabChange: (tab: PanelTab) => void;
  pendingCount: number;
  chatUnread: number;
  mobileVisible: boolean;
  // The quiet half of the story-capture nudge: a dot on the DM tab. The loud
  // half is the banner above the composer (src/lib/dm/beat-cadence.ts).
  storyDue: boolean;
}) {
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const { tab, steersStory } = content;

  const items = useMemo<IconRailItem<PanelTab>[]>(
    () =>
      tabs.map(([value, label, icon, tip]) => ({
        value,
        label,
        icon,
        tip,
        // The approval queue is the lead's only while they steer the story,
        // so the lead tab carries the count on that condition and the Notes
        // tab keeps it unconditionally as before.
        badge:
          value === "chat"
            ? chatUnread || undefined
            : (value === "notes" || (value === "lead" && steersStory)) && pendingCount
              ? pendingCount
              : undefined,
        dot: value === "chat" && chatUnread > 0 ? "red" : value === "dm" && storyDue ? "amber" : undefined,
        // The one place in the rail that is not the DM's gold: the same
        // ember the composer's Direct pill wears (see tabAccentClass).
        accent: value === "lead" ? "ember" : "gold",
      })),
    [tabs, chatUnread, pendingCount, steersStory, storyDue],
  );

  return (
    <aside
      className={cn(
        "shrink-0 bg-gradient-to-b from-stone-950/70 to-stone-950/30 lg:flex lg:flex-row lg:border-l lg:border-stone-700/50 lg:transition-[width] lg:duration-200",
        mobileVisible ? "flex w-full min-w-0 flex-col" : "hidden",
        // The content keeps its old 20rem and 26rem; the rail adds 4rem.
        wide ? "lg:w-[30rem]" : "lg:w-[24rem]",
      )}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto w-full max-w-2xl lg:max-w-none">
          <SidePanelRouter {...content} />
        </div>
      </div>
      {/* The rail sits on the outer edge, away from the chat, so the eye
          reads chat, context, then the switch between contexts. It scrolls
          on a short window rather than clipping the last tabs. */}
      <div className="hidden w-16 shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-l border-stone-700/40 px-1.5 py-2 [scrollbar-width:none] lg:flex">
        <Tooltip content={wide ? "Narrow the panel" : "Widen the panel"} side="left">
          <button
            type="button"
            onClick={() => setWide(!wide)}
            aria-label={wide ? "Narrow the panel" : "Widen the panel"}
            className="flex h-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-900/60 hover:text-stone-300"
          >
            {wide ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </Tooltip>
        <IconRail items={items} value={tab} onChange={onTabChange} tipSide="left" />
      </div>
    </aside>
  );
}

// Memoized: the session view re-renders on every streamed DM token, and
// this panel's props are unchanged during narration.
export const SidePanel = memo(SidePanelInner);
