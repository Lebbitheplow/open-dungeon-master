// A spell's material components as the server keeps them
// (docs/dnd-rules-audit-2026-10-09-extent.md, F09 and F10).
//
//   - A component with a price is a list of what it is, what one is worth,
//     how many the casting takes (per creature, per corpse, per Hit Die) and
//     whether the spell consumes it. Nine SRD spells print theirs in a way a
//     single price cannot hold (Clone's diamond and vessel, Warding Bond's
//     pair of rings): their rows are written out below.
//   - A carried line counts only when it states its worth ("Diamond (300 gp)")
//     and that worth covers the component; a name alone proves nothing.
//   - What the caster does not carry may be bought from the purse outside a
//     fight. In a fight there is no merchant: it must be carried.
//   - A material with no price is replaced by a component pouch or the
//     caster's spellcasting focus, which they must have.
//
// Pure: the Hand (src/lib/battlemap/hand-spells.ts) asks the same questions.

import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { COPPER_PER_GOLD, purseCopper } from "@/lib/srd/currency";

export type MaterialComponent = {
  // The words a carried line must share.
  what: string;
  // What one is worth, in gold pieces.
  gp: number;
  // How many the casting takes, each worth `gp` (Warding Bond's two rings);
  // 1 when one or more pieces together make the worth (Revivify's diamonds).
  count: number;
  // The count is per creature affected, per corpse, or per Hit Die.
  per?: "creature" | "corpse" | "hit die";
  consumed: boolean;
};

// The printed components a single price cannot hold (SRD 5.1).
const PRINTED: Record<string, MaterialComponent[]> = {
  clone: [
    { what: "diamond", gp: 1000, count: 1, consumed: true },
    { what: "vessel", gp: 2000, count: 1, consumed: false },
  ],
  "astral projection": [
    { what: "jacinth", gp: 1000, count: 1, per: "creature", consumed: true },
    { what: "silver bar", gp: 100, count: 1, per: "creature", consumed: true },
  ],
  "create undead": [{ what: "black onyx stone", gp: 150, count: 1, per: "corpse", consumed: false }],
  imprisonment: [{ what: "likeness component", gp: 500, count: 1, per: "hit die", consumed: false }],
  "legend lore": [
    { what: "incense", gp: 250, count: 1, consumed: true },
    { what: "ivory strip", gp: 50, count: 4, consumed: false },
  ],
  "magnificent mansion": [
    { what: "ivory portal", gp: 5, count: 1, consumed: false },
    { what: "polished marble", gp: 5, count: 1, consumed: false },
    { what: "silver spoon", gp: 5, count: 1, consumed: false },
  ],
  "warding bond": [{ what: "platinum ring", gp: 50, count: 2, consumed: false }],
  "secret chest": [
    { what: "chest", gp: 5000, count: 1, consumed: false },
    { what: "replica", gp: 50, count: 1, consumed: false },
  ],
  simulacrum: [{ what: "ruby dust", gp: 1500, count: 1, consumed: true }],
};

export function materialComponents(facts: Pick<SpellFacts, "name" | "material" | "materialCostGp" | "materialText" | "materialConsumed"> | null): MaterialComponent[] {
  if (!facts?.material) {
    return [];
  }
  // The SRD's own name, without a wizard's ("Mordenkainen's Magnificent Mansion").
  const key = facts.name.trim().toLowerCase();
  const printed = PRINTED[key] ?? PRINTED[key.replace(/^[a-z]+'s\s+/, "")];
  if (printed) {
    return printed;
  }
  if (!facts.materialCostGp) {
    return [];
  }
  return [{ what: facts.materialText, gp: facts.materialCostGp, count: 1, consumed: facts.materialConsumed }];
}

const STOP = new Set([
  "worth", "least", "which", "spell", "consumes", "consumed", "with", "each", "that", "this",
  "from", "your", "must", "have", "into", "such", "made", "total", "value", "together",
  "piece", "pinch", "small", "tiny", "rare", "sprinkling", "sprinkle", "powdered", "crushed",
]);

export function materialWords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/\d[\d,]*\s*gp/g, " ")
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4 && !STOP.has(word))
      .map((word) => word.replace(/s$/, "")),
  )];
}

// The worth a line states in its own name: "Diamond (300 gp)" is 300 for one.
export function statedValue(name: string): number | null {
  const match = /(\d[\d,]*)\s*gp\b/i.exec(name);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export type MaterialUse = { index: number; itemName: string; take: number; consume: boolean };
export type MaterialBuy = { name: string; qty: number; copper: number; consume: boolean };

export type MaterialPlan =
  | { kind: "none" }
  // What the casting takes of the carried lines, and what it buys.
  | { kind: "components"; uses: MaterialUse[]; bought: MaterialBuy[] };

export type MaterialContext = {
  // A fight leaves no time to buy anything.
  inFight?: boolean;
  // Creatures affected, corpses raised, the target's Hit Dice.
  units?: number;
  slotLevel?: number | null;
};

type Holder = Pick<CharacterSheet, "name" | "equipment" | "gold" | "copper">;

// How many times a component's count is taken.
function unitsFor(component: MaterialComponent, spell: string, ctx: MaterialContext): number | string {
  if (!component.per) {
    return 1;
  }
  if (ctx.units && ctx.units > 0) {
    return Math.floor(ctx.units);
  }
  if (component.per === "creature") {
    return 1;
  }
  if (component.per === "corpse") {
    // Create Undead: three corpses at 6th level, one more for each slot above.
    return Math.max(1, (ctx.slotLevel ?? 6) - 3);
  }
  return `${spell}'s component is worth ${component.gp} gp per Hit Die of its target: name the target so the server knows its Hit Dice. Nothing was spent.`;
}

const title = (word: string) => `${word[0].toUpperCase()}${word.slice(1)}`;

export function materialPlan(sheet: Holder, facts: SpellFacts | null, ctx: MaterialContext = {}): MaterialPlan | { error: string } {
  const components = materialComponents(facts);
  if (!facts || !components.length) {
    return { kind: "none" };
  }
  const uses: MaterialUse[] = [];
  const bought: MaterialBuy[] = [];
  const taken = new Map<number, number>();
  let purse = purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 });
  for (const component of components) {
    const units = unitsFor(component, facts.name, ctx);
    if (typeof units === "string") {
      return { error: units };
    }
    const words = materialWords(component.what);
    // Lines that name the component and state what one is worth.
    const lines = sheet.equipment
      .map((item, index) => ({ item, index, value: statedValue(item.name), free: Math.max(1, item.qty ?? 1) - (taken.get(index) ?? 0) }))
      .filter(({ item, value, free }) => free > 0 && value !== null && (words.length ? words.some((word) => item.name.toLowerCase().includes(word)) : true));
    const pieces = component.count * units;
    let missing: { qty: number; gp: number } | null = null;
    if (component.count === 1 && !component.per) {
      // One worth, made by as many pieces as it takes, the dearest first.
      let short = component.gp;
      for (const line of lines.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))) {
        if (short <= 0) break;
        const take = Math.min(line.free, Math.ceil(short / (line.value ?? 1)));
        short -= take * (line.value ?? 0);
        taken.set(line.index, (taken.get(line.index) ?? 0) + take);
        uses.push({ index: line.index, itemName: line.item.name, take, consume: component.consumed });
      }
      if (short > 0) missing = { qty: 1, gp: short };
    } else {
      // So many pieces, each worth the price.
      let short = pieces;
      for (const line of lines.filter((entry) => (entry.value ?? 0) >= component.gp)) {
        if (short <= 0) break;
        const take = Math.min(line.free, short);
        short -= take;
        taken.set(line.index, (taken.get(line.index) ?? 0) + take);
        uses.push({ index: line.index, itemName: line.item.name, take, consume: component.consumed });
      }
      if (short > 0) missing = { qty: short, gp: component.gp };
    }
    if (!missing) {
      continue;
    }
    const short = component.what.split(/\s+/).length <= 3 ? component.what : words[0] ?? "";
    const name = `${short ? title(short) : `${facts.name} component`} (${missing.gp} gp)`;
    const copper = missing.qty * missing.gp * COPPER_PER_GOLD;
    const stated = /\d\s*gp/i.test(component.what);
    const printed = `${pieces > 1 ? `${pieces} × ` : ""}${component.what.replace(/\.$/, "")}${stated ? "" : ` worth ${component.gp} gp${pieces > 1 ? " each" : ""}`}${component.consumed && !/consum/i.test(component.what) ? ", which the spell consumes" : ""}`;
    if (ctx.inFight) {
      return {
        error: `${facts.name} needs ${printed}, and ${sheet.name} does not carry it (a line on the sheet that states its worth, like "${name}"). There is no buying one in the middle of a fight. No slot was spent.`,
      };
    }
    if (purse < copper) {
      return {
        error: `${facts.name} needs ${printed}. ${sheet.name} carries none (a line on the sheet that states its worth, like "${name}") and has not the gold to buy it. No slot was spent.`,
      };
    }
    purse -= copper;
    bought.push({ name, qty: missing.qty, copper, consume: component.consumed });
  }
  return { kind: "components", uses, bought };
}

// ---- a focus or a component pouch ----

const POUCH = /component pouch/i;
const FOCI: Record<string, RegExp> = {
  arcane: /arcane focus|\bcrystal\b|\borb\b|\brod\b|\bstaff\b|\bwand\b/i,
  holy: /holy symbol|\bamulet\b|\bemblem\b|\breliquary\b/i,
  druidic: /druidic focus|mistletoe|\btotem\b|yew wand|wooden staff|\bstaff\b/i,
  instrument: /\blute\b|\blyre\b|\bflute\b|\bdrum\b|\bhorn\b|bagpipes|dulcimer|shawm|\bviol\b|instrument/i,
  tools: /thieves'? tools|artisan'?s? tools|\btools\b|infused/i,
};
const CLASS_FOCUS: Record<string, string[]> = {
  wizard: ["arcane"],
  sorcerer: ["arcane"],
  warlock: ["arcane"],
  cleric: ["holy"],
  paladin: ["holy"],
  druid: ["druidic"],
  bard: ["instrument"],
  artificer: ["tools"],
};

// A material with no price needs a component pouch or the caster's focus.
// The priced parts are the materialPlan's to find; an item's own spell (a
// scroll, a wand) never asks (cast-guard.ts castFromItem).
export function focusProblem(sheet: Pick<CharacterSheet, "name" | "class" | "classes" | "equipment">, facts: SpellFacts | null): string | null {
  if (!facts?.material || materialComponents(facts).length) {
    return null;
  }
  const carried = sheet.equipment.map((item) => item.name);
  if (carried.some((name) => POUCH.test(name))) {
    return null;
  }
  const classIds = [sheet.class, ...(sheet.classes ?? []).map((entry) => entry.id)].map((id) => (id ?? "").trim().toLowerCase());
  const kinds = [...new Set(classIds.flatMap((id) => CLASS_FOCUS[id] ?? []))];
  // A caster whose class names no focus (a ranger, a fighter's Eldritch
  // Knight reads an arcane one) may use any.
  const allowed = kinds.length ? kinds : Object.keys(FOCI);
  if (carried.some((name) => allowed.some((kind) => FOCI[kind].test(name)))) {
    return null;
  }
  const what = kinds.length ? kinds.map((kind) => (kind === "arcane" ? "an arcane focus" : kind === "holy" ? "a holy symbol" : kind === "druidic" ? "a druidic focus" : kind === "instrument" ? "a musical instrument" : "artisan's tools")).join(" or ") : "a spellcasting focus";
  return `${facts.name} has a material component${facts.materialText ? ` (${facts.materialText.replace(/\.$/, "")})` : ""}: ${sheet.name} needs a component pouch or ${what} to cast it, and carries neither. Add one to the sheet. No slot was spent.`;
}
