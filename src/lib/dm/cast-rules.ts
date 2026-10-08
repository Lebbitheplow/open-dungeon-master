// May this character cast this spell, and what does the cast cost.
//
// Before this module every cast path asked its own version of the question.
// cast_at_enemy read hit points, use_spell_slot read the spell list and the
// wild shape, pc_attack read neither slot nor list, and none of them read the
// turn. The rules are gathered here, one function each, and
// src/lib/dm/cast-guard.ts asks them in order above the first spend.
//
// Pure: the sheet, the spell's facts and the turn budget come in as values,
// so scripts/test-cast-rules.mjs walks every branch without a database.

import { castsWithHandsFull } from "@/lib/srd/feat-combat";
import { featTwinOf } from "@/lib/srd/feat-effects";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { acBreakdownFor } from "@/lib/srd";
import { subclassSpellsFor } from "@/lib/srd/features";
import { describeCastingTime, type SpellFacts } from "@/lib/srd/spell-facts";
import { casterViewsOf, notReadyReason, spellbookOf } from "@/lib/srd/spell-prep";
import { COPPER_PER_GOLD, purseCopper } from "@/lib/srd/currency";
import { wearsUntrainedArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";
import { spendAction, spendCastAttack, type TurnBudget } from "@/lib/dm/action-budget";
import { masteredSpell, pactLevelFor } from "@/lib/dm/cast-slot-choice";

export type CastRefusal = { error: string };

type Caster = Pick<
  CharacterSheet,
  | "name"
  | "class"
  | "level"
  | "subclass"
  | "classes"
  | "abilities"
  | "spellcasting"
  | "conditions"
  | "features"
  | "feats"
  | "equipment"
  | "proficiencies"
  | "wildShape"
  | "gold"
  | "copper"
>;

// Names are compared as a person hears them: case, spacing and an apostrophe
// make no difference, but a part of a name is not the name.
export function spellKeyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesOf(spell: string, facts: SpellFacts | null): Set<string> {
  return new Set([spell, facts?.name ?? "", ...(facts?.aliases ?? [])].map(spellKeyOf).filter(Boolean));
}

const hasName = (list: string[] | undefined, names: Set<string>) =>
  (list ?? []).some((entry) => names.has(spellKeyOf(entry)));

// A content pack twin of the feat (Level Up's Rite Master is Ritual
// Caster) counts as the feat (src/lib/srd/feat-effects.ts).
const hasFeat = (sheet: Pick<Caster, "feats" | "features">, feat: string) =>
  [...(sheet.feats ?? []), ...(sheet.features ?? []).map((feature) => feature.name)].some(
    (entry) => entry.toLowerCase().includes(feat) || featTwinOf(entry).includes(feat),
  );

// ---- who holds the spell ----

// Classes whose Spellcasting feature lets them cast a spell they hold as a
// ritual (SRD 5.1; the artificer is ODM's).
const RITUAL_CASTERS = new Set(["bard", "cleric", "druid", "wizard", "artificer"]);

export function canCastRituals(sheet: Caster): boolean {
  const classIds = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  return (
    classIds.some((id) => RITUAL_CASTERS.has(id.trim().toLowerCase())) ||
    hasFeat(sheet, "ritual caster") ||
    hasFeat(sheet, "book of ancient secrets")
  );
}

// The caster has the spell ready: a cantrip they know, a spell they know or
// have prepared, or one their subclass keeps always prepared. A spell waiting
// for a long rest, or only written in a wizard's book, is not ready. A wizard
// casting a RITUAL reads it from the book.
export function spellHeldProblem(
  sheet: Caster,
  spell: string,
  facts: SpellFacts | null,
  options: { ritual?: boolean } = {},
): string | null {
  const casting = sheet.spellcasting;
  if (!casting) {
    return `${sheet.name} has no Spellcasting feature and cannot cast spells.`;
  }
  const names = namesOf(spell, facts);
  const lists = [casting, ...(casting.casters ?? [])];
  if (lists.some((entry) => hasName([...(entry.cantrips ?? []), ...entry.known, ...entry.prepared], names))) {
    return null;
  }
  const views = casterViewsOf(sheet);
  if (views.some((view) => hasName(subclassSpellsFor(view.classId, view.subclass, view.level), names))) {
    return null;
  }
  if (
    options.ritual &&
    views.some((view) => view.style === "spellbook" && hasName(spellbookOf(view), names))
  ) {
    return null;
  }
  // Ritual Caster's book (src/lib/srd/feat-spells.ts): its rituals are read
  // from the sheet's spellbook whatever the class, as rituals only.
  if (options.ritual && hasFeat(sheet, "ritual caster") && hasName(casting.spellbook, names)) {
    return null;
  }
  const ready = [...new Set(lists.flatMap((entry) => [...(entry.cantrips ?? []), ...entry.known, ...entry.prepared]))];
  return (
    notReadyReason(casting, facts?.name ?? spell) ??
    notReadyReason(casting, spell) ??
    `${sheet.name} cannot cast "${spell}": it is not among the spells they know or have prepared (${ready.join(", ") || "none"}).`
  );
}

// ---- the caster's own state ----

export function casterStateProblem(sheet: Caster): string | null {
  if (sheet.conditions.some((entry) => entry.trim().toLowerCase() === "raging")) {
    return `${sheet.name} is raging and cannot cast spells or concentrate on them. They can cast once the rage ends.`;
  }
  if (sheet.wildShape) {
    const polymorphed = sheet.wildShape.kind === "polymorph";
    const beastSpells =
      !polymorphed &&
      sheet.features.some((feature) => feature.name.toLowerCase().includes("beast spells"));
    if (!beastSpells) {
      return polymorphed
        ? `${sheet.name} is polymorphed into a ${sheet.wildShape.form} and cannot cast spells; the form has no capacity for it. The spell waits until the transformation ends.`
        : `${sheet.name} is wild shaped as a ${sheet.wildShape.form} and cannot cast spells in beast form, cantrips included (that unlocks with Beast Spells at druid level 18). They can revert with use_resource on Wild Shape.`;
    }
  }
  // SRD 5.1, Armor: armor worn without the training for it bars casting.
  if (wearsUntrainedArmor(sheet)) {
    const armor = acBreakdownFor(sheet);
    const worn = [armor.armorName, armor.shieldName].filter(Boolean).join(" and ");
    return `${sheet.name} is wearing armor they are not trained in (${worn || "their armor"}) and cannot cast spells in it. They cast again once it is off.`;
  }
  return null;
}

// ---- components ----

const MUTE = ["silenced", "gagged", "muted"];

// How many of the caster's two hands are busy. A hand is busy when it holds
// the shield the character wears or a weapon marked as equipped on the sheet.
// A two-handed weapon needs both hands only for the swing, so between swings
// it is held in one. Nothing else on a sheet says what is in a hand, so
// nothing else counts.
export function handsBusy(sheet: Pick<Caster, "equipment" | "proficiencies" | "class" | "level" | "features" | "classes" | "abilities" | "conditions">): number {
  const shield = acBreakdownFor(sheet).shieldName ? 1 : 0;
  const weapons = sheet.equipment
    .filter((item: EquipmentItem) => item.equipped === true && matchWeapon(item.name) !== null)
    .reduce((sum, item) => sum + Math.max(1, item.qty ?? 1), 0);
  return Math.min(2, shield + weapons);
}

// Classes that may bear their spellcasting focus on a shield (a holy symbol
// as an emblem), which makes the shield hand the hand for a material.
const EMBLEM_BEARERS = new Set(["cleric", "paladin"]);

export function componentProblem(sheet: Caster, facts: SpellFacts | null): string | null {
  if (!facts) {
    return null;
  }
  const mute = sheet.conditions.find((entry) => MUTE.includes(entry.trim().toLowerCase()));
  if (facts.verbal && mute) {
    return `${facts.name} has a verbal component and ${sheet.name} is ${mute}: they cannot speak the words. A spell with no verbal component could still be cast.`;
  }
  if (!facts.somatic && !facts.material) {
    return null;
  }
  if (handsBusy(sheet) < 2 || castsWithHandsFull(sheet)) {
    return null;
  }
  const classIds = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  const emblem =
    facts.material &&
    Boolean(acBreakdownFor(sheet).shieldName) &&
    classIds.some((id) => EMBLEM_BEARERS.has(id.trim().toLowerCase()));
  if (emblem) {
    return null;
  }
  return `${facts.name} needs a free hand for its ${facts.somatic ? "gestures" : "material component"}, and both of ${sheet.name}'s hands are full. They must put a weapon away or lower the shield first (unequip it on the sheet).`;
}

// ---- a material that costs ----

export type MaterialPlan =
  | { kind: "none" }
  // The caster carries it. `consume` takes one from the row.
  | { kind: "item"; index: number; itemName: string; consume: boolean }
  // The caster pays for it. A material the spell does not consume is bought
  // and kept: `keepAs` is the line it is written on the sheet as.
  | { kind: "purse"; copper: number; consume: boolean; keepAs: string };

const MATERIAL_STOP = new Set([
  "worth", "least", "which", "spell", "consumes", "consumed", "with", "each", "that", "this",
  "from", "your", "must", "have", "into", "such", "made", "least", "total", "value", "together",
  "piece", "pinch", "small", "tiny", "rare", "sprinkling", "sprinkle", "powdered", "crushed",
]);

function materialWords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/\d[\d,]*\s*gp/g, " ")
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4 && !MATERIAL_STOP.has(word))
      .map((word) => word.replace(/s$/, "")),
  )];
}

// The gold piece value a line of equipment states in its own name:
// "Diamond (300 gp)" is 300. Null when it states none.
function statedValue(name: string): number | null {
  const match = /(\d[\d,]*)\s*gp\b/i.exec(name);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function materialPlan(sheet: Caster, facts: SpellFacts | null): MaterialPlan | CastRefusal {
  if (!facts?.material || !facts.materialCostGp) {
    return { kind: "none" };
  }
  const cost = facts.materialCostGp;
  const words = materialWords(facts.materialText);
  const index = sheet.equipment.findIndex((item) => {
    const value = statedValue(item.name);
    const name = item.name.toLowerCase();
    const named = words.length
      ? words.some((word) => name.includes(word))
      : // The checklist keeps no words: a line that names the spell's price
        // is taken for its component.
        value !== null;
    return named && (value === null ? words.length > 0 : value >= cost);
  });
  if (index >= 0) {
    return { kind: "item", index, itemName: sheet.equipment[index].name, consume: facts.materialConsumed };
  }
  const purse = purseCopper({ gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 });
  if (purse >= cost * COPPER_PER_GOLD) {
    const what = words[0] ? `${words[0][0].toUpperCase()}${words[0].slice(1)}` : `${facts.name} component`;
    return {
      kind: "purse",
      copper: cost * COPPER_PER_GOLD,
      consume: facts.materialConsumed,
      keepAs: `${what} (${cost} gp)`,
    };
  }
  return {
    error: `${facts.name} needs a material component worth ${cost} gp${
      facts.materialText ? ` (${facts.materialText.replace(/\.$/, "")})` : ""
    }${facts.materialConsumed ? ", which the spell consumes" : ""}. ${sheet.name} carries none and has not the gold to have bought one. No slot was spent.`,
  };
}

// ---- the slot ----

export type SlotPlan =
  | { kind: "none"; note: string }
  | { kind: "slot" | "pact"; level: number; state: { max: number; used: number } };

export function slotPlan(
  sheet: Caster,
  spell: string,
  facts: SpellFacts | null,
  named: number | undefined,
): SlotPlan | CastRefusal {
  const casting = sheet.spellcasting;
  const names = namesOf(spell, facts);
  const cantrip =
    facts ? facts.level === 0 : hasName([casting, ...(casting?.casters ?? [])].flatMap((entry) => entry?.cantrips ?? []), names);
  if (spell && cantrip) {
    return { kind: "none", note: `${facts?.name ?? spell} is a cantrip: no spell slot is spent. Cantrips are unlimited.` };
  }
  // Spell Mastery (wizard 18): the chosen 1st and 2nd level spells, cast at
  // their own level, spend no slot.
  if (facts && facts.level <= 2 && (!named || named === facts.level) && masteredSpell(sheet, names)) {
    return { kind: "none", note: `${facts.name} is mastered (Spell Mastery): cast at its own level, no slot is spent.` };
  }
  const level = Math.floor(named && named > 0 ? named : (facts ? pactLevelFor(sheet, facts, names) : 0));
  if (level < 1 || level > 9) {
    return {
      error: spell
        ? `${spell} is not a spell the server knows, so the slot level it is cast from must be named (1 to 9).`
        : "A spell slot has a level from 1 to 9; name the level to spend.",
    };
  }
  if (facts && level < facts.level) {
    return {
      error: `${facts.name} is a level ${facts.level} spell; it cannot be cast from a level ${level} slot. Use a slot of level ${facts.level} or higher.`,
    };
  }
  // Multiclass warlock: a Pact Magic slot of the right level is spent first
  // when the spell sits on the warlock entry's list (it comes back on a short
  // rest, so burning it before the shared pool is strictly kind); shared
  // slots are the fallback in both directions.
  const pact = casting?.pact;
  const warlock = casting?.casters?.find((caster) => caster.classId.trim().toLowerCase() === "warlock");
  const onWarlockList =
    !spell ||
    Boolean(warlock && hasName([...(warlock.cantrips ?? []), ...warlock.known, ...warlock.prepared], names));
  const pactFree = Boolean(pact && pact.level === level && pact.used < pact.max);
  if (pact && pactFree && onWarlockList) {
    return { kind: "pact", level, state: { max: pact.max, used: pact.used + 1 } };
  }
  const slot = casting?.slots[String(level)];
  if (slot && slot.used < slot.max) {
    return { kind: "slot", level, state: { max: slot.max, used: slot.used + 1 } };
  }
  if (pact && pactFree) {
    return { kind: "pact", level, state: { max: pact.max, used: pact.used + 1 } };
  }
  return {
    error: `${sheet.name} has no free level ${level} spell slot.${
      facts && facts.level <= level ? ` ${facts.name} needs a slot of level ${facts.level} or higher that is not yet spent.` : ""
    }`,
  };
}

// ---- rituals and long castings ----

export function ritualProblem(
  sheet: Caster,
  spell: string,
  facts: SpellFacts | null,
  inFight: boolean,
): string | null {
  if (!spell) {
    return "A ritual is a named spell with the ritual tag; name the spell being cast.";
  }
  if (!facts) {
    return `${spell} is not a spell the server knows to be a ritual; it needs a slot.`;
  }
  if (!facts.ritual) {
    return `${facts.name} has no ritual tag; it cannot be cast as a ritual and needs a slot.`;
  }
  if (!canCastRituals(sheet)) {
    return `${sheet.name}'s class does not cast rituals (bards, clerics, druids and wizards do); ${facts.name} needs a slot.`;
  }
  if (inFight) {
    return `A ritual takes ten minutes longer than the spell; ${facts.name} cannot be cast as one in the middle of a fight. It can be cast from a slot, or as a ritual once the fight is over.`;
  }
  return null;
}

export function longCastingProblem(facts: SpellFacts | null, inFight: boolean): string | null {
  if (!facts || typeof facts.castingTime !== "number" || !inFight) {
    return null;
  }
  return `${facts.name} takes ${describeCastingTime(facts.castingTime)} to cast, far longer than a turn; it cannot be cast in the middle of a fight. It can be cast once the fight is over.`;
}

// ---- the turn ----

// What the turn budget remembers of the spells cast this turn, kept in its
// once-per-turn list so the budget's own shape stays as it is.
export const BONUS_SPELL = "spell:bonus-action";
export const LEVELLED_SPELL = "spell:levelled";
const SHARES = "cast-shares";

// A casting whose attack rolls, darts or targets are resolved one call at a
// time (Eldritch Blast's beams, Scorching Ray, Bane on three creatures): how
// many the casting still holds, and the slot it was cast from.
export type OpenCast = { spell: string; slotLevel: number | null; left: number };

export function openCastOf(budget: TurnBudget | null, spell: string): OpenCast | null {
  const wanted = spellKeyOf(spell);
  for (const entry of budget?.oncePerTurn ?? []) {
    const [tag, name, slot, left] = entry.split("|");
    if (tag === SHARES && name === wanted && Number(left) > 0) {
      return { spell: wanted, slotLevel: slot === "-" ? null : Number(slot), left: Number(left) };
    }
  }
  return null;
}

export function withOpenCast(budget: TurnBudget, open: OpenCast): TurnBudget {
  const wanted = spellKeyOf(open.spell);
  const kept = budget.oncePerTurn.filter((entry) => {
    const [tag, name] = entry.split("|");
    return !(tag === SHARES && name === wanted);
  });
  return {
    ...budget,
    oncePerTurn:
      open.left > 0
        ? [...kept, [SHARES, wanted, open.slotLevel ?? "-", open.left].join("|")]
        : kept,
  };
}

export type TurnCharge =
  | { kind: "free" }
  | { kind: "budget"; budget: TurnBudget; cost: "action" | "bonus action"; note?: string }
  | { kind: "reaction" };

// What the casting time costs of the turn. `budget` is the live budget of
// the caster's own turn, or null when it is not their turn or there is no
// fight. `reactionSpent` says whether their reaction is gone.
export function turnCharge(input: {
  who: string;
  facts: SpellFacts | null;
  spell: string;
  slotLevel: number | null;
  inFight: boolean;
  budget: TurnBudget | null;
  reactionSpent: boolean;
}): TurnCharge | CastRefusal {
  const { who, facts, budget, inFight } = input;
  const name = facts?.name ?? input.spell;
  if (!inFight) {
    return { kind: "free" };
  }
  const time = facts?.castingTime ?? "action";
  const levelled = (facts ? facts.level : (input.slotLevel ?? 0)) > 0;
  const marks = budget?.oncePerTurn ?? [];
  // SRD 5.1, Casting Time, Bonus Action: a spell cast with a bonus action
  // leaves the turn room for one other spell only, a cantrip with a casting
  // time of one action.
  if (time === "bonus" && marks.includes(LEVELLED_SPELL)) {
    return {
      error: `${who} has already cast a levelled spell this turn, so ${name} cannot be cast with the bonus action: beside a bonus action spell the only other spell of the turn is a cantrip.`,
    };
  }
  if (time !== "bonus" && levelled && marks.includes(BONUS_SPELL)) {
    return {
      error: `${who} has cast a spell with their bonus action this turn, so the only other spell they can cast is a cantrip with a casting time of one action. ${name} waits for another turn.`,
    };
  }
  if (time === "reaction") {
    if (input.reactionSpent) {
      return {
        error: `${who} has already used their reaction; it comes back at the start of their next turn. ${name} is not cast.`,
      };
    }
    return { kind: "reaction" };
  }
  if (!budget) {
    return { kind: "free" };
  }
  const mark = (next: TurnBudget): TurnBudget => ({
    ...next,
    oncePerTurn: [
      ...next.oncePerTurn,
      ...(time === "bonus" && !next.oncePerTurn.includes(BONUS_SPELL) ? [BONUS_SPELL] : []),
      ...(time !== "bonus" && levelled && !next.oncePerTurn.includes(LEVELLED_SPELL) ? [LEVELLED_SPELL] : []),
    ],
  });
  const spent =
    time === "bonus"
      ? spendAction(budget, "bonus", `casting ${name}`, who)
      : spendCastAttack(budget, name, who);
  if (!spent.ok) {
    return { error: spent.error };
  }
  return {
    kind: "budget",
    budget: mark(spent.budget),
    cost: time === "bonus" ? "bonus action" : "action",
    ...(spent.note ? { note: spent.note } : {}),
  };
}
