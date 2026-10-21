// Which tabs the play table's side panel offers, and in what order.
//
// The list used to be assembled inline in buildPanelTabs, one conditional
// spread per tab, which was fine while the only gated tabs were the DM
// console and Context. The Lead tab makes it three authorities deciding
// four tabs (the DM seat, the lead seat, story authority, the battle map),
// and the pairing of "who sees it" with "what label and icon it gets" hid
// the ordering rule in a wall of JSX. So the decision lives here, as a pure
// function over booleans, and the presentation stays in SessionTabs.
//
// Pure by design: no "@/" imports and no React, so
// scripts/test-table-tabs.mjs can import it directly.

export type TableTabId =
  | "dm"
  | "lead"
  | "party"
  | "battle"
  | "map"
  | "story"
  | "notes"
  | "chat"
  | "world"
  | "context"
  | "settings";

// Every tab, in the rail's order, for the modules that keep something per
// tab (the layout's panes, the rail's paintings) and their tests.
export const TABLE_TAB_IDS: readonly TableTabId[] = [
  "dm",
  "lead",
  "party",
  "battle",
  "map",
  "story",
  "notes",
  "chat",
  "world",
  "context",
  "settings",
];

export type TableTabInput = {
  // A battle map is live, so the tactical tab has something to show.
  hasBattleMap: boolean;
  mapsEnabled: boolean;
  // The campaign has loaded; Setup (and Context) render from it.
  hasSettings: boolean;
  // The Context tab shows what the DM was actually sent, which includes the
  // secret arc and the DM outline. Its route is gated on story authority, so
  // offering the tab to anyone else only ever produces a 403 and a broken
  // panel. That authority is the party lead in an AI campaign and the DM in a
  // human-run one (src/lib/dm/viewer.ts). The World tab is the campaign's
  // WorldForge, hidden truths and all, behind the same authority, so it
  // follows the same flag.
  secretStory: boolean;
  // Holds the DM seat: the console is the whole of running the table by
  // hand, so it leads the rail for whoever is doing it and does not exist
  // for anyone else.
  adjudicates: boolean;
  // Owns the table: invites, campaign details, the lead seat. Distinct from
  // story authority, because a lead at a human-DM table keeps these while
  // the DM keeps the story, and the tab exists for both halves.
  isLead: boolean;
};

// The DM console first, then the lead's desk, then the tabs everyone shares,
// then the story authority's two references (the world and what the DM was
// sent). The two seats lead the rail because they are the tabs with work
// waiting in them; a player never sees either, so for them Party stays first
// as it always has.
export function visiblePanelTabs({
  hasBattleMap,
  mapsEnabled,
  hasSettings,
  secretStory,
  adjudicates,
  isLead,
}: TableTabInput): TableTabId[] {
  const tabs: TableTabId[] = [];
  if (adjudicates) {
    tabs.push("dm");
  }
  if (isLead) {
    tabs.push("lead");
  }
  tabs.push("party");
  if (hasBattleMap) {
    tabs.push("battle");
  }
  if (mapsEnabled) {
    tabs.push("map");
  }
  tabs.push("story", "notes", "chat");
  if (hasSettings && secretStory) {
    tabs.push("world", "context");
  }
  if (hasSettings) {
    tabs.push("settings");
  }
  return tabs;
}

// The phone's bottom bar has room for the Table cell, five tabs and More.
// The tabs a seat uses most stay on the bar (the DM's console and the lead's
// desk because work waits in them, the board while a fight is on, then the
// party, the story and chat); the rest are one tap away under More, which
// lists every one of them, so nothing has to be found by scrolling sideways.
export const PHONE_BAR_SLOTS = 5;
const PHONE_PRIORITY: TableTabId[] = ["dm", "lead", "battle", "party", "story", "chat", "map", "world", "notes", "context", "settings"];

export function phoneBarSplit(tabs: TableTabId[]): { bar: TableTabId[]; more: TableTabId[] } {
  // Six fit as they are; More would only hide one tab behind a second tap.
  if (tabs.length <= PHONE_BAR_SLOTS + 1) {
    return { bar: [...tabs], more: [] };
  }
  const keep = new Set(
    [...tabs].sort((a, b) => PHONE_PRIORITY.indexOf(a) - PHONE_PRIORITY.indexOf(b)).slice(0, PHONE_BAR_SLOTS),
  );
  return { bar: tabs.filter((tab) => keep.has(tab)), more: tabs.filter((tab) => !keep.has(tab)) };
}

// Where a chat line's Browse wares goes (MessageItem.tsx): the Market
// section of the Party tab, in the side panel at a desk, and on a phone in
// place of the table, the same panel whether Party sits on the bar or under
// More; the bar's Table cell is the way back. The shop rides along, with
// the moment of the press, so the Market brings that shop into view and a
// second press on the same line is a second request.
export type MarketRequest = { shopId: string; at: number };

export function browseWares(shopId: string, at: number): {
  tab: TableTabId;
  section: "market";
  mobileView: "panel";
  request: MarketRequest;
} {
  return { tab: "party", section: "market", mobileView: "panel", request: { shopId, at } };
}
