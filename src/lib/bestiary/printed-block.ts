// The whole block as the source printed it (src/lib/bestiary/statblock.ts
// parseMonster builds it): every trait, action, reaction and legendary
// action, each marked with whether the engine runs it or the DM does, and
// the entry it was copied from. Kept beside the compact lines the fights
// read so nothing the book printed is lost on the way to a copy
// (docs/workshop-rulebook-audit-pr169.md F05, F18).

import { parseAttack } from "@/lib/bestiary/attack-parse";
import { ENGINE_TRAIT_NAMES, parseAbilityText } from "@/lib/dm/monster-abilities";

type RawAction = { name?: unknown; desc?: unknown; attack_bonus?: unknown; damage_dice?: unknown; damage_bonus?: unknown };

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

// "runs": the engine reads it (an attack it rolls, a trait it applies, a
// breath weapon whose numbers it parses, a legendary line it offers).
// "text": printed for the DM to run by hand.
export type PrintedAbility = { name: string; desc: string; engine: "runs" | "text" };

// Where a copy's block came from: the published entry's name, its book and
// the bundled rulebook page it is printed on.
export type PrintedSource = { name: string; document?: string; rulebook?: string };

export type PrintedBlock = {
  traits: PrintedAbility[];
  actions: PrintedAbility[];
  reactions: PrintedAbility[];
  legendary: PrintedAbility[];
  // "The dragon can take 3 legendary actions..."
  legendaryDesc?: string;
  source?: PrintedSource;
};

export const PRINTED_LIMITS = { entries: 40, name: 80, desc: 4_000 };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function sourceOf(raw: unknown): PrintedSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = text(item.name, PRINTED_LIMITS.name);
  if (!name) return null;
  const document = text(item.document, 120);
  const rulebook = text(item.rulebook, 120);
  return { name, ...(document ? { document } : {}), ...(rulebook ? { rulebook } : {}) };
}

// The source's whole block, each entry with its engine status (see
// PrintedAbility). Null for a row that prints nothing beyond its numbers.
export function printedBlockOf(data: Record<string, unknown>, actions: RawAction[], specials: RawAction[]): PrintedBlock | null {
  const entry = (raw: RawAction, engine: PrintedAbility["engine"]): PrintedAbility | null => {
    const name = asString(raw.name).trim().slice(0, PRINTED_LIMITS.name);
    const desc = asString(raw.desc).replace(/\s+/g, " ").trim().slice(0, PRINTED_LIMITS.desc);
    return name && desc ? { name, desc, engine } : null;
  };
  const numbers = (raw: RawAction) => parseAbilityText(asString(raw.name), asString(raw.desc)) !== null;
  const list = (rows: RawAction[], runs: (raw: RawAction) => boolean) =>
    rows
      .map((raw) => entry(raw, runs(raw) ? "runs" : "text"))
      .filter((row): row is PrintedAbility => row !== null)
      .slice(0, PRINTED_LIMITS.entries);
  const reactions = Array.isArray(data.reactions) ? (data.reactions as RawAction[]) : [];
  const legendary = Array.isArray(data.legendary_actions) ? (data.legendary_actions as RawAction[]) : [];
  const block: PrintedBlock = {
    traits: list(specials, (raw) => ENGINE_TRAIT_NAMES.test(asString(raw.name)) || /^regeneration\b/i.test(asString(raw.name)) || numbers(raw)),
    actions: list(actions, (raw) => parseAttack(raw) !== null || /multiattack/i.test(asString(raw.name)) || numbers(raw)),
    // A Parry adds to AC (src/lib/dm/enemy-reactions.ts); other reactions
    // are the DM's.
    reactions: list(reactions, (raw) => /^parry\b/i.test(asString(raw.name))),
    // legendary_action offers each line (src/lib/dm/legendary-logic.ts).
    legendary: list(legendary, () => true),
    ...(asString(data.legendary_desc).trim() ? { legendaryDesc: asString(data.legendary_desc).trim().slice(0, PRINTED_LIMITS.desc) } : {}),
  };
  return block.traits.length || block.actions.length || block.reactions.length || block.legendary.length ? block : null;
}

// A printed block as it arrives from a client or an old row, kept to its
// shape and limits; null for anything else.
export function normalizePrintedBlock(raw: unknown): PrintedBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const list = (value: unknown): PrintedAbility[] =>
    (Array.isArray(value) ? value : [])
      .map((row) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const name = text(item.name, PRINTED_LIMITS.name);
        const desc = text(item.desc, PRINTED_LIMITS.desc);
        return name && desc ? { name, desc, engine: item.engine === "runs" ? ("runs" as const) : ("text" as const) } : null;
      })
      .filter((row): row is PrintedAbility => row !== null)
      .slice(0, PRINTED_LIMITS.entries);
  const from = sourceOf(source.source);
  const block: PrintedBlock = {
    traits: list(source.traits),
    actions: list(source.actions),
    reactions: list(source.reactions),
    legendary: list(source.legendary),
    ...(text(source.legendaryDesc, PRINTED_LIMITS.desc) ? { legendaryDesc: text(source.legendaryDesc, PRINTED_LIMITS.desc) } : {}),
    ...(from ? { source: from } : {}),
  };
  return block.traits.length || block.actions.length || block.reactions.length || block.legendary.length ? block : null;
}

// The printed abilities the compact lines leave out (the cap on traits, a
// line cut short) and the engine does not run: what the DM has to know is
// there. Their names, and the first words of each.
export function unrunPrintedAbilities(stats: { traits?: string[]; printed?: PrintedBlock }): PrintedAbility[] {
  const printed = stats.printed;
  if (!printed) {
    return [];
  }
  const carried = (stats.traits ?? []).map((line) => line.toLowerCase());
  const named = (ability: PrintedAbility) => carried.some((line) => line.includes(ability.name.toLowerCase()) && !line.endsWith("..."));
  return [...printed.traits, ...printed.actions, ...printed.reactions].filter((ability) => ability.engine === "text" && !named(ability));
}
