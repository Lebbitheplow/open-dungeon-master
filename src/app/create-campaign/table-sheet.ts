import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";

// The table sheet's pure half: which switches the Feel step shows, in which
// group, which of them the "features on" total counts, and what a press
// does to the draft. FeelStep draws this; scripts/test-world-portals.mjs
// holds the count to thirteen.

// Which of the table features are switched on, counting only the ones the
// wizard actually showed: a hidden toggle is not a choice the table made.
// The review step reads this so its "n on" agrees with the grid.
export function featuresOn(draft: CampaignDraft, gates: WizardGates): number {
  const { aiNarrates, solo } = gates;
  const bonds = draft.relationships !== "off";
  return [
    aiNarrates && draft.aiStorySetup,
    draft.ttsEnabled,
    draft.mapsEnabled,
    draft.ambienceEnabled,
    draft.ambienceEnabled && draft.ambienceAuto,
    draft.multiclassingEnabled,
    aiNarrates && draft.worldSimulation,
    draft.inventoryApprovals,
    bonds,
    bonds && draft.romance !== "off",
    aiNarrates && draft.narrationGuard,
    !solo && draft.midGameJoinOpen,
    !solo && draft.holdSubmissions,
  ].filter(Boolean).length;
}

export type SheetGroupId = "narration" | "senses" | "people" | "rules";

export type SheetRowKey =
  | "aiStorySetup"
  | "narrationGuard"
  | "worldSimulation"
  | "ttsEnabled"
  | "mapsEnabled"
  | "ambienceEnabled"
  | "ambienceAuto"
  | "presentation"
  | "relationships"
  | "romance"
  | "multiCharacter"
  | "midGameJoinOpen"
  | "holdSubmissions"
  | "multiclassingEnabled"
  | "inventoryApprovals"
  | "boardDrawing"
  | "enemyIntent";

// Which explainer a row carries; FeelStep maps these to the lobby's texts.
export type SheetInfo = "livingWorld" | "bonds" | "romance" | "narrationGuard";

export type SheetRow = {
  key: SheetRowKey;
  label: string;
  hint: string;
  on: boolean;
  // Where the knob rests: 0 off, 1 on, 0.5 for the middle of the tri-state.
  knob: 0 | 0.5 | 1;
  // True for the thirteen rows featuresOn() adds up.
  counted: boolean;
  disabled: boolean;
  // A row that exists because its parent is on arrives rather than blinks in.
  dependent: boolean;
  info: SheetInfo | null;
};

export type SheetGroup = { id: SheetGroupId; label: string; note: string; rows: SheetRow[] };

type RowSpec = {
  key: SheetRowKey;
  group: SheetGroupId;
  counted: boolean;
  aiOnly?: boolean;
  tableOnly?: boolean;
  needs?: "ambienceEnabled" | "relationships";
  info?: SheetInfo;
};

// Order inside a group is the order on screen. A dependent row sits right
// after its parent so it appears beside the switch that summoned it.
const ROWS: RowSpec[] = [
  { key: "aiStorySetup", group: "narration", counted: true, aiOnly: true },
  { key: "narrationGuard", group: "narration", counted: true, aiOnly: true, info: "narrationGuard" },
  { key: "worldSimulation", group: "narration", counted: true, aiOnly: true, info: "livingWorld" },
  { key: "ttsEnabled", group: "senses", counted: true },
  { key: "mapsEnabled", group: "senses", counted: true },
  { key: "ambienceEnabled", group: "senses", counted: true },
  { key: "ambienceAuto", group: "senses", counted: true, needs: "ambienceEnabled" },
  { key: "presentation", group: "senses", counted: false },
  { key: "relationships", group: "people", counted: true, info: "bonds" },
  { key: "romance", group: "people", counted: true, needs: "relationships", info: "romance" },
  { key: "multiCharacter", group: "people", counted: false },
  { key: "midGameJoinOpen", group: "people", counted: true, tableOnly: true },
  { key: "holdSubmissions", group: "people", counted: true, tableOnly: true },
  { key: "multiclassingEnabled", group: "rules", counted: true },
  { key: "inventoryApprovals", group: "rules", counted: true },
  { key: "boardDrawing", group: "rules", counted: false },
  { key: "enemyIntent", group: "rules", counted: false },
];

const GROUPS: Array<{ id: SheetGroupId; label: string; note: string }> = [
  { id: "narration", label: "The narrator", note: "only with an AI narrator" },
  { id: "senses", label: "Sight and sound", note: "" },
  { id: "people", label: "People and the floor", note: "" },
  { id: "rules", label: "Rules at the table", note: "" },
];

function parentOn(draft: CampaignDraft, needs: RowSpec["needs"]): boolean {
  if (needs === "ambienceEnabled") return draft.ambienceEnabled;
  if (needs === "relationships") return draft.relationships !== "off";
  return true;
}

function gated(spec: RowSpec, gates: WizardGates): boolean {
  return Boolean((spec.aiOnly && !gates.aiNarrates) || (spec.tableOnly && gates.solo));
}

function copy(spec: RowSpec, draft: CampaignDraft, gates: WizardGates): { label: string; hint: string } {
  switch (spec.key) {
    case "aiStorySetup":
      return { label: "AI story setup", hint: "The DM invents the plot" };
    case "narrationGuard":
      return { label: "Outcome check", hint: "Narration that contradicts the dice is rewritten" };
    case "worldSimulation":
      return { label: "Living world", hint: "Off-screen schemes and rumors advance on their own" };
    case "ttsEnabled":
      return {
        label: "Voice narration",
        hint: gates.ttsAvailable ? "Spoken DM narration" : "No speech service on this server",
      };
    case "mapsEnabled":
      return {
        label: "Maps",
        hint: gates.mapsAvailable ? "AI-drawn area maps" : "No image service on this server",
      };
    case "ambienceEnabled":
      return { label: "Ambience", hint: "Room tone, music and stings" };
    case "ambienceAuto":
      return { label: "Sound follows the scene", hint: "Off leaves it to the DM" };
    case "presentation":
      return {
        label: "Theatre inserts",
        hint: "A speaking NPC's face over the scene art while their lines play",
      };
    case "relationships":
      return { label: "Bonds", hint: "NPCs remember how each character treated them" };
    case "romance":
      return { label: "Romance", hint: "Bonds can grow into a relationship" };
    case "multiCharacter":
      return {
        label:
          draft.multiCharacter === "all_active"
            ? "Several characters each, all fielded"
            : draft.multiCharacter === "one_active"
              ? "Several characters each, one at a time"
              : "One character each",
        hint: "A player may build more than one; press again to field them all at once (solo tables)",
      };
    case "midGameJoinOpen":
      return { label: "Mid-game joining", hint: "New players can use the invite code after the start" };
    case "holdSubmissions":
      return { label: "Held responses", hint: "Nobody acts until the party lead opens the floor" };
    case "multiclassingEnabled":
      return { label: "Multiclassing", hint: "Second classes at level-up" };
    case "inventoryApprovals":
      return { label: "Item offers", hint: "Players confirm DM loot and gold changes" };
    case "boardDrawing":
      return {
        label: "Players draw on the board",
        hint: "Plans and circles on the battle map; the DM always may",
      };
    case "enemyIntent":
      return { label: "Enemy intent", hint: "Show what enemies look likely to do next" };
  }
}

function knobOf(key: SheetRowKey, draft: CampaignDraft): 0 | 0.5 | 1 {
  switch (key) {
    case "presentation":
      return draft.presentation === "theatre" ? 1 : 0;
    case "relationships":
      return draft.relationships !== "off" ? 1 : 0;
    case "romance":
      return draft.romance !== "off" ? 1 : 0;
    case "multiCharacter":
      return draft.multiCharacter === "all_active" ? 1 : draft.multiCharacter === "one_active" ? 0.5 : 0;
    default:
      return draft[key] ? 1 : 0;
  }
}

// The groups as the step draws them. A group with nothing to show is left
// out, which is how the narrator block disappears when a person narrates.
export function tableSheet(draft: CampaignDraft, gates: WizardGates): SheetGroup[] {
  return GROUPS.map((group) => ({
    ...group,
    rows: ROWS.filter(
      (spec) => spec.group === group.id && !gated(spec, gates) && parentOn(draft, spec.needs),
    ).map((spec) => {
      const knob = knobOf(spec.key, draft);
      return {
        key: spec.key,
        ...copy(spec, draft, gates),
        on: knob > 0,
        knob,
        counted: spec.counted,
        // One server switch away rather than a feature this install can
        // never have, so the row stays visible and says why it is off.
        disabled:
          (spec.key === "ttsEnabled" && !gates.ttsAvailable) ||
          (spec.key === "mapsEnabled" && !gates.mapsAvailable),
        dependent: Boolean(spec.needs),
        info: spec.info ?? null,
      };
    }),
  })).filter((group) => group.rows.length > 0);
}

// How many switches the total could reach in this mode. A dependent row
// counts even while its parent hides it: it is still a choice on offer.
export function countableRows(gates: WizardGates): number {
  return ROWS.filter((spec) => spec.counted && !gated(spec, gates)).length;
}

// What one press does. The tri-state walks off, one at a time, all at once;
// everything else flips.
export function flipRow(draft: CampaignDraft, key: SheetRowKey): Partial<CampaignDraft> {
  switch (key) {
    case "presentation":
      return { presentation: draft.presentation === "theatre" ? "plain" : "theatre" };
    case "relationships":
      return { relationships: draft.relationships !== "off" ? "off" : "on" };
    case "romance":
      return { romance: draft.romance === "off" ? "on" : "off" };
    case "multiCharacter":
      return {
        multiCharacter:
          draft.multiCharacter === "off"
            ? "one_active"
            : draft.multiCharacter === "one_active"
              ? "all_active"
              : "off",
      };
    default:
      return { [key]: !draft[key] };
  }
}
