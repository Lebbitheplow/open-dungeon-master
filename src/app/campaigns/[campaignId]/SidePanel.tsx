"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { memo, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { tabPane } from "@/lib/table-layout";
import { usePaneShown, useTableLayoutApi } from "@/app/campaigns/[campaignId]/table-layout-context";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  SidePanelRouter,
  type SidePanelRouterProps,
} from "@/app/campaigns/[campaignId]/SidePanelRouter";
import type { PanelTab, PanelTabDef } from "@/app/campaigns/[campaignId]/SessionTabs";

// Whether the aside is docked (Tailwind's lg, where `hidden` no longer
// applies) or is the phone's full-screen panel. The panels' animation loops
// key on this, so a board behind the chat on a phone costs no frames.
// A book-style fold opened flat docks too, one column per leaf, however
// narrow the whole is (world.css lays the columns on the leaves).
const DOCKED_QUERY = "(min-width: 64rem), (horizontal-viewport-segments: 2)";

function subscribeDocked(callback: () => void) {
  const media = window.matchMedia(DOCKED_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function readDocked() {
  return window.matchMedia(DOCKED_QUERY).matches;
}

// Whether the two columns are side by side (the fight stage only makes
// sense then; a phone keeps its bottom bar and its Battle tab).
export function useDocked(): boolean {
  return useSyncExternalStore(subscribeDocked, readDocked, () => true);
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
  glance,
  boardOnStage = false,
  preservePartyState = false,
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
  // The quest line above the panel (CinematicParts.tsx QuestGlance).
  glance?: ReactNode;
  boardOnStage?: boolean;
  preservePartyState?: boolean;
}) {
  // The widen button's two widths are the panel's column in the table's
  // arrangement (src/lib/table-layout.ts); a reader may drag it anywhere
  // between, and an arrangement with the panel beside the table or afloat
  // has no column of its own to widen.
  const layout = useTableLayoutApi();
  const wide = layout?.panelWide ?? false;
  // The server snapshot says docked so the first client render matches the
  // lg layout most desktops hydrate into; a phone corrects it at once.
  const docked = useSyncExternalStore(subscribeDocked, readDocked, () => true);
  // Hidden in the arrangement, or under a maximized pane: still mounted,
  // but its animation loops rest as on a phone.
  const shown = usePaneShown("panel");
  const visible = shown && (docked || mobileVisible);
  const { tab, steersStory } = content;
  // Keep the board's keyed owner while native controls switch beside it.
  const contentTabs: PanelTab[] = boardOnStage ? ["battle", tab === "battle" ? "party" : tab] : [tab];

  const items = useMemo<IconRailItem<PanelTab>[]>(
    () =>
      tabs.map(([value, label, icon, tip]) => ({
        value,
        label,
        icon,
        tip,
        tour: `tab-${value}`,
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
        "cine-panel shrink-0 bg-gradient-to-b from-stone-950/70 to-stone-950/30 lg:flex lg:flex-row lg:border-l lg:border-stone-700/50 lg:transition-[width] lg:duration-200",
        mobileVisible ? "flex w-full min-w-0 flex-col" : "hidden",
        // 24rem unless the arrangement says otherwise (TableLayout.tsx sets
        // the width it draws the column at); the rail takes 4rem of it.
        "lg:w-[var(--tlay-panel-w,24rem)]",
      )}
    >
      {/* side-panel-body: holding the board it stops scrolling as one
          piece and gives the board the room left (world.css, issue 87). */}
      <div className="side-panel-body min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        {glance}
        {/* Keyed by tab so the incoming panel rises in instead of cutting. */}
        {tabs.length ? (
          contentTabs.map((contentTab) => (
            <div
              // A staged Battle tab shows the same roster as Party.
              key={preservePartyState && content.stageBoard && contentTab === "battle" ? "party" : contentTab}
              className="motion-tab mx-auto w-full max-w-2xl lg:max-w-none"
              data-session-region={boardOnStage ? (contentTab === "battle" ? "board" : "controls") : undefined}
            >
              <SidePanelRouter {...content} tab={contentTab} visible={visible} onOpenTab={onTabChange} />
            </div>
          ))
        ) : (
          <p className="motion-tab px-2 py-6 text-center font-serif text-sm italic text-stone-400">
            Every tab has a pane of its own. Put one back from its bar to see it here again.
          </p>
        )}
      </div>
      {/* The rail sits on the outer edge, away from the chat, so the eye
          reads chat, context, then the switch between contexts. It scrolls
          on a short window rather than clipping the last tabs. */}
      <div className="cine-rail hidden w-16 shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-l border-amber-500/15 bg-gradient-to-b from-stone-950/60 to-transparent px-1.5 py-2 [scrollbar-width:none] lg:flex">
        {layout?.canWiden ? (
          <Tooltip content={wide ? "Narrow the panel" : "Widen the panel"} side="left">
            <button
              type="button"
              onClick={() => layout.setPanelWide(!wide)}
              aria-label={wide ? "Narrow the panel" : "Widen the panel"}
              className={cn(ui.railCell, "h-8 shrink-0 justify-center py-0")}
            >
              {wide ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          </Tooltip>
        ) : null}
        <IconRail items={items} value={tab} onChange={onTabChange} tipSide="left" />
      </div>
    </aside>
  );
}

// Memoized: the session view re-renders on every streamed DM token, and
// this panel's props are unchanged during narration.
export const SidePanel = memo(SidePanelInner);

// One side-panel tab in a pane of its own (client issue 46): the same panel
// the rail would open, so Party, Story and Notes can be read side by side.
// Its tab leaves the rail while it has a pane (SessionView), so no panel is
// ever drawn twice and a battle board never has a twin.
function TabPaneInner({
  paneTab,
  paneLabel,
  onOpenTab,
  ...content
}: Omit<SidePanelRouterProps, "tab" | "visible" | "onOpenTab"> & {
  paneTab: PanelTab;
  paneLabel: string;
  onOpenTab: (tab: PanelTab) => void;
}) {
  const visible = usePaneShown(tabPane(paneTab));
  return (
    <section className="tlay-pane flex min-h-0 min-w-0 flex-col" aria-label={paneLabel}>
      <div className="side-panel-body min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        <div className="motion-tab w-full">
          <SidePanelRouter {...content} tab={paneTab} visible={visible} onOpenTab={onOpenTab} />
        </div>
      </div>
    </section>
  );
}

export const TabPane = memo(TabPaneInner);
