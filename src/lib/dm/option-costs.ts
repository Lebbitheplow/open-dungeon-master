// What one option of a pool costs, for the pools whose options cost different
// things and so carry no ResourceDef.action (issue 233): Channel Divinity's
// options, the Psi Warrior's and Soulknife's Psionic Energy, and the Battle
// Master's Superiority Dice. use_resource charges the option's cost through
// prepareResourceCharge (src/lib/dm/resource-turn.ts); before this every
// option the engine does not resolve itself cost nothing.
//
// Channel Divinity, by each option's own words (PHB, XGtE, TCoE, SCAG, DMG):
// "As an action" for most; Vow of Enmity, Champion Challenge, Turn the Tide,
// Emissary of Peace, Peerless Athlete and Inspiring Smite are bonus actions;
// War God's Blessing and Rebuke the Violent are reactions; Guided Strike,
// Destructive Wrath and Touch of Death ride a roll the cleric or paladin is
// already making; Artisan's Blessing is an hour-long ritual.
//
// Pure: no imports beyond types.
import type { ResourceAction } from "@/lib/srd/class-resources";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Cost = ResourceAction | "ritual" | "use_reaction" | "on_swing";

const CHANNEL_DIVINITY: Array<[string, Cost]> = [
  ["turn undead", "action"],
  ["destroy undead", "action"],
  ["knowledge of the ages", "action"],
  ["read thoughts", "action"],
  ["preserve life", "action"],
  ["radiance of the dawn", "action"],
  ["charm animals and plants", "action"],
  ["destructive wrath", "none"],
  ["invoke duplicity", "action"],
  ["cloak of shadows", "action"],
  ["guided strike", "none"],
  ["war god's blessing", "reaction"],
  ["touch of death", "none"],
  ["artisan's blessing", "ritual"],
  ["path to the grave", "action"],
  ["order's demand", "action"],
  ["balm of peace", "action"],
  ["twilight sanctuary", "action"],
  ["arcane abjuration", "action"],
  ["sacred weapon", "action"],
  ["turn the unholy", "action"],
  ["nature's wrath", "action"],
  ["turn the faithless", "action"],
  ["abjure enemy", "action"],
  ["vow of enmity", "bonus"],
  ["conquering presence", "action"],
  ["emissary of peace", "bonus"],
  ["rebuke the violent", "reaction"],
  ["peerless athlete", "bonus"],
  ["inspiring smite", "bonus"],
  ["watcher's will", "action"],
  ["abjure the extraplanar", "action"],
  ["champion challenge", "bonus"],
  ["turn the tide", "bonus"],
  ["control undead", "action"],
  ["dreadful aspect", "action"],
];

// TCoE: Telekinetic Movement and Psychic Whispers are actions, Psychic
// Teleportation and Psi-Powered Leap bonus actions, Protective Field a
// reaction; Psionic Strike, Telekinetic Thrust, Psi-Bolstered Knack and
// Homing Strikes ride a hit or a check already made.
const PSIONIC_ENERGY: Array<[string, Cost]> = [
  ["telekinetic movement", "action"],
  ["psychic whispers", "action"],
  ["psychic teleportation", "bonus"],
  ["psi-powered leap", "bonus"],
  ["protective field", "reaction"],
  ["psionic strike", "none"],
  ["telekinetic thrust", "none"],
  ["psi-bolstered knack", "none"],
  ["homing strikes", "none"],
];

// The maneuvers spent through use_resource (src/lib/dm/maneuver-rules.ts):
// Rally is the bonus action; a reaction goes through use_reaction and a
// swing's maneuver through pc_attack; the rest ride a check or a move.
const SUPERIORITY: Array<[string, Cost]> = [
  ["rally", "bonus"],
  ["parry", "use_reaction"],
  ["riposte", "use_reaction"],
  ["brace", "use_reaction"],
  ["feinting attack", "on_swing"],
  ["quick toss", "on_swing"],
  ["grappling strike", "on_swing"],
  ["maneuvering attack", "on_swing"],
  ["ambush", "none"],
  ["bait and switch", "none"],
  ["commanding presence", "none"],
  ["evasive footwork", "none"],
  ["tactical assessment", "none"],
];

const TABLES: Record<string, Array<[string, Cost]>> = {
  channel_divinity: CHANNEL_DIVINITY,
  sub_psionic_energy: PSIONIC_ENERGY,
  sub_superiority_dice: SUPERIORITY,
};

const plain = (text: string) => text.trim().toLowerCase().replace(/[’`]/g, "'");

// The option a call names, by its words (the variant, or the resource name
// "Channel Divinity: Vow of Enmity"), and what it costs.
export function optionCost(
  defId: string | undefined,
  named: string,
  inFight: boolean,
): { option: string; cost: ResourceAction } | { refused: ToolError } | null {
  const table = defId ? TABLES[defId] : undefined;
  const text = textKey(named);
  const found = table?.find(([option]) => text.includes(textKey(option)));
  if (!found) {
    return null;
  }
  const [option, cost] = found;
  const shown = option.replace(/\b\w/g, (letter) => letter.toUpperCase());
  switch (cost) {
    case "ritual":
      return inFight
        ? { refused: { error: `${shown} is an hour-long ritual, not something done in a fight. Nothing was spent.`, refused: "rules" } }
        : { option, cost: "none" };
    case "use_reaction":
      return { refused: { error: `${shown} is a reaction: use_reaction with feature "${shown}" when its trigger comes. Nothing was spent.`, retry: true } };
    case "on_swing":
      return { refused: { error: `${shown} rides the weapon attack: name it in pc_attack's maneuver. Nothing was spent.`, retry: true } };
    default:
      return { option, cost };
  }
}

export type HeldOption = { name: string; cost: ResourceAction | "ritual" };

const costOf = (table: Array<[string, Cost]>, name: string): ResourceAction | "ritual" => {
  const cost = table.find(([option]) => textKey(name).includes(textKey(option)))?.[1] ?? "action";
  return cost === "use_reaction" ? "reaction" : cost === "on_swing" ? "none" : cost;
};

type OptionSheet = { features: Array<{ name: string }>; class?: string; classes?: Array<{ id: string }> };

// The Channel Divinity options the sheet holds: its "Channel Divinity: ..."
// features, with a cleric's Turn Undead.
export function channelOptions(sheet: OptionSheet): HeldOption[] {
  const named = sheet.features
    .map((feature) => /^channel divinity:\s*(.+)$/i.exec(feature.name.trim())?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
  const cleric = plain(sheet.class ?? "") === "cleric" || (sheet.classes ?? []).some((entry) => plain(entry.id) === "cleric");
  const all = cleric && !named.some((name) => textKey(name).includes("turn undead")) ? ["Turn Undead", ...named] : named;
  return [...new Set(all)].map((name) => ({ name, cost: costOf(CHANNEL_DIVINITY, name) }));
}

// The Psionic Energy uses the sheet's features name.
export function psionicOptions(sheet: OptionSheet): HeldOption[] {
  const out: HeldOption[] = [];
  for (const feature of sheet.features) {
    const found = PSIONIC_ENERGY.find(([option]) => textKey(feature.name) === textKey(option) || textKey(feature.name).startsWith(`${textKey(option)} `));
    if (found && !out.some((entry) => textKey(entry.name) === textKey(found[0]))) {
      out.push({ name: feature.name.trim(), cost: costOf(PSIONIC_ENERGY, found[0]) });
    }
  }
  return out;
}

const WORDS: Record<HeldOption["cost"], string> = {
  action: "action",
  bonus: "bonus action",
  reaction: "reaction",
  none: "no action",
  ritual: "an hour's ritual",
};

// The Channel Divinity options the sheet holds with their costs, for a call
// that names none in a fight.
export function channelOptionsHeld(sheet: OptionSheet): string[] {
  return channelOptions(sheet).map((option) => `${option.name} (${WORDS[option.cost]})`);
}
