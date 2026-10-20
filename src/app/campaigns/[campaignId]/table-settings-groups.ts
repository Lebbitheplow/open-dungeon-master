import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { DELEGATIONS } from "@/lib/dm/delegation";
import { CAMPAIGN_LENGTH_LABELS, TABLE_LANGUAGE_LABELS } from "@/lib/schemas/game-settings-options";
import { bondsSummary, boardSummary, safetySummary, voiceSummary } from "@/app/create-campaign/summaries";
import { textKey } from "@/lib/language/text-logic";

// The live table's settings, in the named groups the campaign creator taught
// (src/app/create-campaign/groups.ts): a lead who met "Bonds and romance"
// while making the table finds it under the same name in the lobby and in
// play. Which groups a table shows, what each says on its closed face, and
// which group holds a row another panel links to. Pure, for
// scripts/test-table-settings-groups.mjs.

export type TableGroupId =
  | "world"
  | "character"
  | "narration"
  | "atmosphere"
  | "safety"
  | "ai"
  | "memory"
  | "bonds"
  | "players"
  | "console"
  | "board"
  | "voiceChat";

export type TableGroup = { id: TableGroupId; title: string; glyph: string };

// What the panel needs to know besides the settings themselves.
export type TableGroupContext = {
  // The name of the world pack, when the table has one installed here.
  packName: string | null;
  // The genre preset's name, for a table without a pack.
  genreName: string;
  // The narration voice's display name.
  voiceName: string;
  // Narration is off for the whole server (Admin > Speech).
  narrationOff: boolean;
  // The server's own rule for rolled stats, in words.
  statsRule: string;
};

const ORDER: TableGroupId[] = [
  "world",
  "character",
  "narration",
  "atmosphere",
  "safety",
  "ai",
  "memory",
  "bonds",
  "players",
  "console",
  "board",
  "voiceChat",
];

const GLYPHS: Record<TableGroupId, string> = {
  world: "system-world",
  character: "tab-characters",
  narration: "cue-bell",
  atmosphere: "tab-ambience",
  safety: "ui-lock",
  ai: "ui-ai",
  memory: "tab-facts",
  bonds: "tab-bonds",
  players: "tab-party",
  console: "tab-dm",
  board: "tab-battle",
  voiceChat: "ui-voice",
};

const onOff = (on: boolean) => (on ? "on" : "off");
const HP_WORDS = { average: "average hit points", rolled: "rolled hit points", max: "maximum hit points" } as const;
const ALLY_WORDS = { auto: "automatic", full: "party members and guests", guests: "guests only", off: "off" } as const;

// The allies row lives in this group at a table a person runs too, where
// it shows only once an Off or guests-only setting shuts companions out.
export function alliesShown(settings: GameSettings): boolean {
  return settings.dmMode !== "human" || settings.companions === "off" || settings.companions === "guests";
}

function title(id: TableGroupId, settings: GameSettings): string {
  const aiNarrates = settings.dmMode !== "human";
  switch (id) {
    case "world":
      return "World and story";
    case "character":
      return "Character creation";
    case "narration":
      return "Narration and character voices";
    case "atmosphere":
      return "Atmosphere";
    case "safety":
      return "Safety and boundaries";
    case "ai":
      return aiNarrates ? "AI storytelling and allies" : "Allies";
    case "memory":
      return "Narrator memory";
    case "bonds":
      return "Bonds and romance";
    case "players":
      return "Players and permissions";
    case "console":
      return "DM reminders";
    case "board":
      return "Battle board";
    case "voiceChat":
      return "Live voice chat";
  }
}

function shown(id: TableGroupId, settings: GameSettings): boolean {
  const aiNarrates = settings.dmMode !== "human";
  if (id === "ai") return aiNarrates || alliesShown(settings);
  // The narrator's pipeline only exists where the AI narrates.
  if (id === "memory") return aiNarrates;
  // Only the DM seat is ever nudged to write the story down.
  if (id === "console") return settings.dmMode !== "ai";
  return true;
}

// The groups this table shows, in the creator's order.
export function tableGroups(settings: GameSettings): TableGroup[] {
  return ORDER.filter((id) => shown(id, settings)).map((id) => ({ id, title: title(id, settings), glyph: GLYPHS[id] }));
}

const ASSIST_WORDS = { monsters: "the monsters", narration: "reading beats aloud", cover: "covering for you" } as const;

function assistWords(settings: GameSettings): string {
  const helps = DELEGATIONS.filter((which) => settings.dmAssist[which]).map((which) => ASSIST_WORDS[which]);
  return helps.length ? `AI helps with ${helps.join(", ")}` : "AI helps with nothing";
}

// The line on a closed group's face: what is set inside, never a count to
// fill up.
export function tableGroupSummary(id: TableGroupId, settings: GameSettings, context: TableGroupContext): string {
  const aiNarrates = settings.dmMode !== "human";
  switch (id) {
    case "world":
      return [
        context.packName ?? context.genreName,
        TABLE_LANGUAGE_LABELS[settings.tableLanguage],
        aiNarrates ? `${CAMPAIGN_LENGTH_LABELS[settings.campaignLength].split(" (")[0]} length` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "character":
      return [
        HP_WORDS[settings.hpMethod ?? "average"],
        settings.startingWealth === "rolled" ? "rolled gold" : "starting kit",
        settings.dicePolicy === "real_allowed" ? "real dice allowed" : "digital dice",
        `stats: ${context.statsRule}`,
        `multiclassing ${onOff(settings.multiclassingEnabled)}`,
      ].join(" · ");
    case "narration":
      if (context.narrationOff) return "Off on this server: nothing is read aloud";
      return settings.ttsEnabled
        ? `Read aloud · ${context.voiceName}`
        : "Off: nothing is read aloud";
    case "atmosphere":
      return [
        `maps ${onOff(settings.mapsEnabled)}`,
        settings.ambienceEnabled ? `ambience on${settings.ambienceAuto ? ", follows the scene" : ""}` : "ambience off",
        `theatre inserts ${onOff(settings.presentation === "theatre")}`,
      ].join(" · ");
    case "safety":
      return safetySummary(settings);
    case "ai":
      return [
        settings.dmMode === "assisted" ? assistWords(settings) : null,
        aiNarrates ? `story setup ${onOff(settings.aiStorySetup)}` : null,
        aiNarrates ? `outcome check ${onOff(settings.narrationGuard)}` : null,
        aiNarrates && settings.narrationLength !== "standard" ? `${settings.narrationLength} narration` : null,
        aiNarrates && settings.styleNotes ? "style notes set" : null,
        aiNarrates && (settings.combatPace ?? "balanced") !== "balanced" ? (settings.combatPace === "rare" ? "fewer fights" : "more fights") : null,
        aiNarrates ? `living world ${onOff(settings.worldSimulation)}` : null,
        alliesShown(settings) ? `allies: ${ALLY_WORDS[settings.companions]}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "memory": {
      const off = STAGES.filter((stage) => !isStageEnabled(settings.stages, stage.id));
      return off.length ? `Off: ${off.map((stage) => stage.label.toLowerCase()).join(", ")}` : "Everything on, as most tables keep it";
    }
    case "bonds":
      return bondsSummary(settings);
    case "players":
      return [
        `joining mid-game ${settings.midGameJoinOpen ? "open" : "closed"}`,
        settings.holdSubmissions ? "held responses" : null,
        settings.waitForTable ? "DM waits for the table" : null,
        settings.inventoryApprovals || settings.vitalsApprovals ? "players confirm changes" : "changes apply at once",
      ]
        .filter(Boolean)
        .join(" · ");
    case "console": {
      const { messages, rolls } = settings.beatReminder;
      if (!messages && !rolls) return "Never reminded";
      return [messages ? `after ${messages} actions` : null, rolls ? `after ${rolls} rolls` : null].filter(Boolean).join(" or ");
    }
    case "board":
      return boardSummary(settings);
    case "voiceChat":
      return voiceSummary(settings.voice);
  }
}

// Rows other panels link to (data-settings-row), and the group holding each,
// so a link can open the group before it brings the row into view.
export const ROW_GROUP: Record<string, TableGroupId> = {
  allies: "ai",
};

// Words a person might search for that the group's title and summary do not
// say: the controls' own labels and the everyday names for them.
const KEYWORDS: Record<TableGroupId, string> = {
  world: "world pack setting genre universe language length saga custom",
  character: "dice real dice digital hit points hp level wealth gold kit gear stats ability scores reroll 4d6 multiclass multiclassing class",
  narration: "narration narrator voice voices read aloud speech tts speak pace character voices volume",
  atmosphere: "maps map ambience music sound audio scene theatre inserts faces portraits",
  safety: "safety x-card lines veils boundaries content tone strictness dc family mature",
  ai: "ai story setup plot outcome check prose narration length short rich verbose style notes voice pacing living world simulation allies companions guests party members assist monsters cover",
  memory: "memory history compaction recall retrieval rules lore chapter summaries stages model advanced",
  bonds: "bonds relationships standing romance",
  players: "players permissions mid-game joining invite held responses floor item offers loot gold vitals damage healing approvals confirm",
  console: "dm reminders remind nudge beats record",
  board: "battle board draw drawing enemy intent",
  voiceChat: "voice chat call microphone mic talk proximity hearing whisper shout walls downed deaf transcription transcribe turns",
};

// Whether a group answers what was typed into the panel's search: every word
// must appear in its title, its summary or its keywords.
export function groupMatches(group: TableGroup, summary: string, query: string): boolean {
  const words = textKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = textKey(`${group.title} ${summary} ${KEYWORDS[group.id]}`);
  return words.every((word) => haystack.includes(word));
}
