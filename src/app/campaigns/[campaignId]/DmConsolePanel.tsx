"use client";

import { EmptyState } from "@/components/EmptyState";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Ribbon } from "@/components/ui/Ribbon";
import { SectionHead } from "@/components/ui/SectionHead";
import { ActionPlate, CloseForm, DeskCard, adjudicationGlyph } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { CommandPalette, type PaletteCommand } from "@/components/CommandPalette";
import { consoleAdjudications, type AdjudicationCategory } from "@/lib/dm/invoke-catalog";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { DmActionForm } from "@/app/campaigns/[campaignId]/DmActionForm";
import { DmBeatComposer } from "@/app/campaigns/[campaignId]/DmBeatComposer";
import { DmDelegationPanel } from "@/app/campaigns/[campaignId]/DmDelegationPanel";
import { DmAssistPanel } from "@/app/campaigns/[campaignId]/DmAssistPanel";
import type { CritRules } from "@/app/campaigns/[campaignId]/DmOddsPanel";
import { DmTablesPanel } from "@/app/campaigns/[campaignId]/DmTablesPanel";
import { DmMapStudioPanel } from "@/app/campaigns/[campaignId]/DmMapStudioPanel";
import { DmMapLibraryPanel } from "@/app/campaigns/[campaignId]/DmMapLibraryPanel";
import { DmNpcForgePanel } from "@/app/campaigns/[campaignId]/DmNpcForgePanel";
import { DmEncounterPrepPanel } from "@/app/campaigns/[campaignId]/DmEncounterPrepPanel";
import { DmBestiaryPanel } from "@/app/campaigns/[campaignId]/DmBestiaryPanel";
import { DmStoryboardPanel } from "@/app/campaigns/[campaignId]/DmStoryboardPanel";
import { DmWorkbenchPanel } from "@/app/campaigns/[campaignId]/DmWorkbenchPanel";
import type { CampaignMessage } from "@/lib/db/messages";
import type { DmBeat } from "@/lib/db/dm-beats";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { DmCover } from "@/lib/dm/delegation";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The DM's console: the queue of what the players have done and not yet been
// answered on, and every adjudication the rules engine can perform.
//
// The action list is not written here. It is rendered from the adjudication
// catalog (src/lib/dm/invoke-catalog.ts), which is the same list the AI DM
// is offered as tools, so a person running the table can do exactly what the
// machine can and the server enforces the rules either way.

// Who may speak, right now. In combat the initiative order owns this and
// the buttons stand down; the rest of the time it is the DM's to set.
function FloorControl({
  campaignId,
  mode,
}: {
  campaignId: string;
  mode: "open" | "hold" | "spotlight" | "initiative";
}) {
  const [busy, setBusy] = useState(false);

  async function set(next: "open" | "hold") {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/floor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set: next }),
      });
    } catch {
      // The floor_changed event is the source of truth; a failed click
      // simply leaves it where it was.
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskCard
      title="The floor"
      glyph="tab-session"
      aside={
        <span key={mode} className="count-pop rounded-full border border-amber-500/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-100">
          {FLOOR_STATUS[mode]}
        </span>
      }
    >
      {mode === "initiative" ? (
        <p className="reveal flex items-center gap-2 text-xs text-stone-400">
          <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" className="shrink-0" />
          The initiative order has it while the fight runs.
        </p>
      ) : (
        <div data-pill-group="" className="flex flex-wrap gap-1.5">
          {(["open", "hold"] as const).map((option) => (
            <button data-on={mode === option ? "" : undefined}
              key={option}
              type="button"
              disabled={busy || mode === option}
              onClick={() => set(option)}
              className={cn(
                ui.btnSmall,
                "min-h-10 text-xs",
                mode === option && "border-amber-500/70 bg-amber-400/10 text-amber-100 shadow-glow-gold disabled:opacity-100",
              )}
            >
              <GameIcon icon={{ kind: "glyph", key: option === "open" ? "tab-chat" : "cue-bell" }} size="size-5" />
              {option === "open" ? "Anyone may act" : "Hold everyone"}
            </button>
          ))}
          {mode === "spotlight" ? (
            <span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-500/70 bg-amber-400/10 px-3 text-xs text-amber-100">
              <GameIcon icon={{ kind: "glyph", key: "tab-lead" }} size="size-5" />
              Spotlight
            </span>
          ) : (
            <span className="basis-full text-[11px] leading-snug text-stone-500">
              Give the floor to named players with Give the floor, under Story.
            </span>
          )}
        </div>
      )}
    </DeskCard>
  );
}

// The floor's state in a word, for the card's corner.
const FLOOR_STATUS = {
  open: "Open",
  hold: "Held",
  spotlight: "Spotlight",
  initiative: "Initiative",
} as const;

// The console rail: the catalog's own categories, plus three tabs that are
// not adjudications at all. "assist" answers questions and applies nothing;
// "tables" is the DM's own reference shelf; "maps" is the prep bench, where
// a map is built before the table sees it and a fight is written down before
// it happens.
type ConsoleTab = AdjudicationCategory | "assist" | "tables" | "maps" | "cast" | "bestiary" | "storyboard";

// The painted glyph each console tab wears in the command palette.
const TAB_GLYPH: Record<ConsoleTab, string> = {
  assist: "tab-dm",
  combat: "tab-battle",
  party: "tab-party",
  world: "tab-map",
  social: "tab-chat",
  story: "tab-story",
  table: "tab-dice",
  maps: "system-maps",
  cast: "system-cast",
  bestiary: "system-bestiary",
  storyboard: "system-storyboard",
  tables: "system-tables",
};

// Rests, death and levelling have glyphs of their own (adjudicationGlyph);
// everything else wears its category's.
function actionGlyph(name: string, category: AdjudicationCategory): string {
  return adjudicationGlyph(name, TAB_GLYPH[category]);
}

export function DmConsolePanel({
  campaignId,
  sheets,
  encounter,
  messages,
  intents,
  floorMode,
  beats,
  variantRules,
  delegations,
  cover,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  messages: CampaignMessage[];
  // Player actions waiting on the DM, oldest first (dm_intent_queued).
  intents: Array<{ messageId: string; userId: string; characterId: string; seq: number }>;
  floorMode: "open" | "hold" | "spotlight" | "initiative";
  // Story already written down, newest first.
  beats: DmBeat[];
  // The table's crit rules, for the assist rail's consequence preview.
  variantRules: CritRules;
  // Assisted mode: which capabilities this table has handed to the AI, read
  // through delegated() on the server side of every one of them.
  delegations: { monsters: boolean; narration: boolean; cover: boolean };
  // The stretch of answers currently handed over, or null.
  cover: DmCover | null;
}) {
  // Illustrate stays in the catalog (the AI DM and the dispatcher still know
  // it) but leaves the console on a server with no image backend, where the
  // form could only ever queue a render that fails. The upload alternative
  // lives on each passage in the transcript.
  const capabilities = useCapabilities();
  const groups = useMemo(() => {
    const all = consoleAdjudications();
    if (offersImages(capabilities)) {
      return all;
    }
    return all
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => entry.name !== "generate_image"),
      }))
      .filter((group) => group.entries.length > 0);
  }, [capabilities]);
  // The rail carries the catalog's own categories plus two that are not
  // adjudications at all: the assist tools, which apply nothing, and the DM's
  // tables and monster lookup, which are reference.
  const [category, setCategory] = useState<ConsoleTab>("assist");
  const [openAction, setOpenAction] = useState("");
  // Lifted so the queue's "what now?" can hand a player's own words to the
  // suggester without the DM retyping them.
  const [assistIntent, setAssistIntent] = useState("");

  const sheetsById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet])),
    [sheets],
  );
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const queue = useMemo(
    () =>
      intents
        .map((intent) => ({
          intent,
          message: messagesById.get(intent.messageId) ?? null,
          name: sheetsById.get(intent.characterId)?.name ?? "Someone",
        }))
        .filter((row) => row.message)
        .sort((a, b) => a.intent.seq - b.intent.seq),
    [intents, messagesById, sheetsById],
  );

  const active = groups.find((group) => group.category === category) ?? null;

  const tabs: Array<readonly [ConsoleTab, string]> = [
    ["assist", "Assist"],
    ...groups.map((group) => [group.category, group.label] as const),
    ["maps", "Maps"],
    ["cast", "Cast"],
    ["bestiary", "Bestiary"],
    ["storyboard", "Storyboard"],
    ["tables", "Tables"],
  ];

  // The palette presses the same buttons the console draws: a tab, an
  // adjudication's row, or a walk to one of the sections above them. It holds
  // no action of its own.
  // Sections are found by the anchors the guided tour already uses.
  function reveal(anchor: string) {
    window.requestAnimationFrame(() =>
      document.querySelector(`[data-tour="${anchor}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }
  function goTo(tab: ConsoleTab, action = "") {
    setCategory(tab);
    setOpenAction(action);
    reveal("dm-console-tabs");
  }
  const sections: Array<[anchor: string, label: string, hint: string, glyph: string]> = [
    ["dm-floor", "The floor", "Who may speak right now", "tab-session"],
    ["dm-beats", "Write the story", "The beat composer", "tab-journal"],
    ...(delegations.monsters || delegations.cover
      ? [["dm-delegation", "Hand things to the AI", "Monsters and cover", "tab-dm"] as [string, string, string, string]]
      : []),
    ["dm-queue", "Waiting on you", queue.length ? `${queue.length} unanswered` : "Nothing waiting", "tab-log"],
  ];
  const commands: PaletteCommand[] = [
    ...groups.flatMap((group) =>
      group.entries.map((entry) => ({
        id: `do-${entry.name}`,
        label: entry.label,
        hint: entry.summary,
        group: group.label,
        glyph: actionGlyph(entry.name, group.category),
        keywords: [entry.name.replace(/_/g, " ")],
        onSelect: () => goTo(group.category, entry.name),
      })),
    ),
    ...tabs.map(([tab, label]) => ({
      id: `tab-${tab}`,
      label: `Open ${label}`,
      group: "Console tabs",
      glyph: TAB_GLYPH[tab],
      keywords: ["tab", "section", tab],
      onSelect: () => goTo(tab),
    })),
    ...sections.map(([anchor, label, hint, glyph]) => ({
      id: `see-${anchor}`,
      label,
      hint,
      group: "On this console",
      glyph,
      keywords: ["jump", "scroll"],
      onSelect: () => reveal(anchor),
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Gold, the DM's colour: nobody else at the table has this tab, and
          the lead's desk wears ember so the two seats never blur. */}
      <div className="flex items-center gap-2">
        <Ribbon tone="gold" className="min-w-0 flex-1">Only you</Ribbon>
        <CommandPalette
          title="DM console commands"
          placeholder="Find an action or a tab"
          commands={commands}
        />
      </div>

      <div data-tour="dm-floor">
        <FloorControl campaignId={campaignId} mode={floorMode} />
      </div>

      {/* Directly under the floor, because this is where the nudge sends
          them and a reminder that lands on a scroll is not a reminder. */}
      <div data-tour="dm-beats">
        <DmBeatComposer campaignId={campaignId} beats={beats} canExpand={delegations.narration} />
      </div>

      {/* The anchor goes only where the panel draws: in pure human mode there
          is nothing to hand over, and an empty anchored div would still give
          the tour a zero-size target to spotlight and talk about. */}
      {delegations.monsters || delegations.cover ? (
        <div data-tour="dm-delegation">
          <DmDelegationPanel
            campaignId={campaignId}
            cover={cover}
            canMonsters={delegations.monsters}
            canCover={delegations.cover}
          />
        </div>
      ) : null}

      <section data-tour="dm-queue" className={cn(ui.card, "dm-card p-3")}>
        <SectionHead
          title="Waiting on you"
          glyph="tab-log"
          aside={
            queue.length ? (
              <span key={queue.length} className="count-pop rounded-full border border-amber-500/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                {queue.length}
              </span>
            ) : (
              "All answered"
            )
          }
        />
        {queue.length ? (
          <ul className="stagger space-y-1.5">
            {queue.map(({ intent, message, name }) => (
              <li
                key={intent.messageId}
                className="rounded-lg border border-amber-500/20 bg-stone-950/50 px-2.5 py-2"
              >
                <p className="font-display text-[11px] tracking-[0.12em] text-amber-200/90">{name}</p>
                <p className="whitespace-pre-wrap text-sm text-stone-200">{message?.content}</p>
                <button
                  type="button"
                  onClick={() => {
                    setAssistIntent(message?.content ?? "");
                    setCategory("assist");
                    setOpenAction("");
                  }}
                  className={cn(ui.btnSmall, "mt-1.5 min-h-9 px-2 py-1 text-xs")}
                >
                  <GameIcon icon={{ kind: "glyph", key: "die-d20" }} size="size-5" />
                  What should I press?
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" art="scrolls" title="Nothing waiting. Everything the party has said has been answered." />
        )}
      </section>

      <section>
        {/* Twelve tabs in a 20rem panel: icon over a small-caps label, four to
            a row, so the rail is three rows instead of five. */}
        <div className="mb-3 grid grid-cols-4 gap-1" data-tour="dm-console-tabs" data-pill-group="">
          {tabs.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              data-on={tab === category ? "" : undefined}
              aria-pressed={tab === category}
              onClick={() => {
                setCategory(tab);
                setOpenAction("");
              }}
              className={cn(
                ui.railCell,
                "dm-tab min-w-0 border border-transparent px-0",
                tab === category && cn(ui.railCellActive, "border-amber-500/40"),
              )}
            >
              <GameIcon icon={{ kind: "glyph", key: TAB_GLYPH[tab] }} size="size-7" />
              <span className="eyebrow max-w-full truncate text-[8.5px] !tracking-normal">{label}</span>
            </button>
          ))}
        </div>

        {/* Keyed by category so the incoming tool rises in instead of cutting. */}
        <div key={category} className="motion-tab">
          {category === "assist" ? (
            <DmAssistPanel
              campaignId={campaignId}
              sheets={sheets}
              encounter={encounter}
              variantRules={variantRules}
              intent={assistIntent}
              onIntentChange={setAssistIntent}
            />
          ) : category === "maps" ? (
            <div className="reveal space-y-4">
              <DmMapStudioPanel campaignId={campaignId} />
              <DmMapLibraryPanel campaignId={campaignId} />
              <DmEncounterPrepPanel campaignId={campaignId} />
            </div>
          ) : category === "cast" ? (
            <DmNpcForgePanel campaignId={campaignId} />
          ) : category === "bestiary" ? (
            <div className="reveal space-y-4">
              <DmBestiaryPanel campaignId={campaignId} />
              <DmWorkbenchPanel campaignId={campaignId} />
            </div>
          ) : category === "storyboard" ? (
            <DmStoryboardPanel campaignId={campaignId} />
          ) : category === "tables" ? (
            <DmTablesPanel campaignId={campaignId} />
          ) : (
          <div>
            {active ? (
              <SectionHead
                title={active.label}
                glyph={TAB_GLYPH[active.category]}
                aside={`${active.entries.length} ${active.entries.length === 1 ? "action" : "actions"}`}
              />
            ) : null}
            <ul className="stagger space-y-1.5">
              {(active?.entries ?? []).map((entry) => (
                <li key={entry.name}>
                  {openAction === entry.name ? (
                    <div className="reveal space-y-1.5">
                      <DmActionForm
                        campaignId={campaignId}
                        entry={entry}
                        sheets={sheets}
                        encounter={encounter}
                        glyph={actionGlyph(entry.name, active?.category ?? "table")}
                      />
                      <CloseForm onClick={() => setOpenAction("")} />
                    </div>
                  ) : (
                    <ActionPlate
                      glyph={actionGlyph(entry.name, active?.category ?? "table")}
                      label={entry.label}
                      summary={entry.summary}
                      onClick={() => setOpenAction(entry.name)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
          )}
        </div>
      </section>
    </div>
  );
}
