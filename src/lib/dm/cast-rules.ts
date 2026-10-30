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

import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import { castsWithHandsFull } from "@/lib/srd/feat-combat";
import { holdsFeat } from "@/lib/srd/feat-effects";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { acBreakdownFor } from "@/lib/srd";
import { subclassSpellsFor } from "@/lib/srd/features";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { casterViewsOf, notReadyReason, spellbookOf } from "@/lib/srd/spell-prep";
import { wearsUntrainedArmor } from "@/lib/srd/armor";
import { matchWeapon } from "@/lib/srd/weapons";
import { spendAction, spendCastAttack, type TurnBudget } from "@/lib/dm/action-budget";
import { masteredSpell, pactLevelFor } from "@/lib/dm/cast-slot-choice";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag } from "@/lib/srd/item-tags";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { pactRitualOf } from "@/lib/srd/class-spell-grants";
import { grantedCastFor, type GrantedCast } from "@/lib/srd/granted-casts";
import type { RacialCantripChoices } from "@/lib/srd/racial-cantrips";

export type CastRefusal = ToolError;

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
> & {
  // An invocation's or a race's cast (src/lib/srd/granted-casts.ts) reads
  // these; a sheet always carries them.
  race?: string;
  racialChoices?: RacialCantripChoices;
  resources?: CharacterSheet["resources"];
};

// A spell's names, compared whole: as written, the content's name and its
// aliases.
export function namesOf(spell: string, facts: SpellFacts | null): Set<string> {
  return new Set([spell, facts?.name ?? "", ...(facts?.aliases ?? [])].map(textKey).filter(Boolean));
}

export const hasName = (list: string[] | undefined, names: Set<string>) =>
  (list ?? []).some((entry) => names.has(textKey(entry)));

// ---- who holds the spell ----

// Classes whose Spellcasting feature lets them cast a spell they hold as a
// ritual (SRD 5.1; the artificer is ODM's).
const RITUAL_CASTERS = new Set(["bard", "cleric", "druid", "wizard", "artificer"]);

export function canCastRituals(sheet: Caster): boolean {
  const classIds = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  return (
    classIds.some((id) => RITUAL_CASTERS.has(id.trim().toLowerCase())) ||
    holdsFeat(sheet, "ritual caster") ||
    holdsFeat(sheet, "book of ancient secrets")
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
  // The table's workshop and pack subclasses, for their always-prepared lists.
  options: { ritual?: boolean; extras?: SubclassExtras } = {},
): ToolError | null {
  const casting = sheet.spellcasting;
  const names = namesOf(spell, facts);
  if (!casting) {
    // A tiefling fighter's Infernal Legacy is cast with no Spellcasting
    // feature at all (granted-casts.ts).
    const grant = options.ritual ? null : grantedCastFor(grantSheet(sheet), names);
    return grant
      ? grantUseProblem(sheet, grant, facts?.name ?? spell)
      : { error: `${sheet.name} has no Spellcasting feature and cannot cast spells.`, refused: "rules" };
  }
  const views = casterViewsOf(sheet);
  // A ritual is cast through the class (or book) that holds it, and only a
  // ritual caster's hold counts: a sorcerer's known ritual on a
  // sorcerer-cleric is cast from a slot. A spell without the ritual tag
  // falls through, and ritualProblem names that.
  if (options.ritual && facts?.ritual) {
    const ritual = ritualHolderProblem(sheet, views, names, facts.name, options.extras);
    if (ritual !== undefined) {
      return ritual;
    }
  }
  const lists = [casting, ...(casting.casters ?? [])];
  if (lists.some((entry) => hasName([...(entry.cantrips ?? []), ...entry.known, ...entry.prepared], names))) {
    return null;
  }
  if (views.some((view) => hasName(subclassSpellsFor(view.classId, view.subclass, view.level, options.extras, view.features), names))) {
    return null;
  }
  // An invocation's spell (Armor of Shadows' mage armor) or a race's
  // (Infernal Legacy's hellish rebuke), which no list holds.
  const grant = options.ritual ? null : grantedCastFor(grantSheet(sheet), names);
  if (grant) {
    return grantUseProblem(sheet, grant, facts?.name ?? spell);
  }
  const ready = [...new Set(lists.flatMap((entry) => [...(entry.cantrips ?? []), ...entry.known, ...entry.prepared]))];
  // A spell the rules know that the caster lacks is the game saying no; a
  // name nobody knows (a typo, another language) is the call's to fix.
  return (
    notReadyReason(casting, facts?.name ?? spell) ??
    notReadyReason(casting, spell) ??
    (facts
      ? {
          error: `${sheet.name} cannot cast "${spell}": it is not among the spells they know or have prepared (${ready.join(", ") || "none"}).`,
          refused: "rules",
        }
      : {
          error: `No spell called "${spell}" is known. ${sheet.name} knows or has prepared ${ready.join(", ") || "no spells"}: send the one meant, by the name on the sheet.`,
          retry: true,
        })
  );
}

// ---- a spell an invocation or a race casts ----

function grantSheet(sheet: Caster) {
  return { race: sheet.race ?? "", level: sheet.level, features: sheet.features, racialChoices: sheet.racialChoices };
}

// Whether the class's own lists (or its subclass's always-prepared spells)
// hold the spell: then it is cast as a class spell, with a slot.
function classHolds(sheet: Caster, names: Set<string>, extras?: SubclassExtras): boolean {
  const casting = sheet.spellcasting;
  if (!casting) {
    return false;
  }
  if ([casting, ...(casting.casters ?? [])].some((entry) => hasName([...(entry.cantrips ?? []), ...entry.known, ...entry.prepared], names))) {
    return true;
  }
  return casterViewsOf(sheet).some((view) => hasName(subclassSpellsFor(view.classId, view.subclass, view.level, extras, view.features), names));
}

// The invocation or racial trait the spell is cast through, when the class's
// lists do not hold it (src/lib/srd/granted-casts.ts), or null.
export function grantedCastOf(sheet: Caster, spell: string, facts: SpellFacts | null, extras?: SubclassExtras): GrantedCast | null {
  const names = namesOf(spell, facts);
  return classHolds(sheet, names, extras) ? null : grantedCastFor(grantSheet(sheet), names);
}

// A once-a-long-rest grant whose use is spent: Infernal Legacy's hellish
// rebuke cast today, Thief of Five Fates' bane. A counter the sheet does not
// carry yet has its use.
function grantUseProblem(sheet: Caster, grant: GrantedCast, spell: string): ToolError | null {
  const state = grant.counter ? sheet.resources?.[grant.counter] : undefined;
  if (state && state.used >= state.max) {
    return { error: `${sheet.name} casts ${spell} through ${grant.source} once, and again after a long rest; that use is spent.`, refused: "rules" };
  }
  return null;
}

// The components as this caster casts the spell: an invocation that casts
// "without ... material components" needs none, and an Archdruid ignores
// the verbal and somatic components of their druid spells and a material
// that has no cost and is not consumed (SRD 5.1, druid, Archdruid).
export function componentsAsCast(sheet: Caster, facts: SpellFacts | null, grant: GrantedCast | null, extras?: SubclassExtras): SpellFacts | null {
  if (!facts) {
    return facts;
  }
  let cast = grant?.noMaterial ? { ...facts, material: false } : facts;
  if (!grant && holdsFeature(sheet, "Archdruid") && druidHolds(sheet, namesOf(facts.name, facts), extras)) {
    cast = { ...cast, verbal: false, somatic: false, material: cast.material && (Boolean(cast.materialCostGp) || cast.materialConsumed) };
  }
  return cast;
}

// The druid's own lists hold the spell (a druid spell of theirs).
function druidHolds(sheet: Caster, names: Set<string>, extras?: SubclassExtras): boolean {
  return casterViewsOf(sheet).some(
    (view) =>
      textKey(view.classId) === "druid" &&
      hasName([...view.cantrips, ...view.known, ...view.prepared, ...subclassSpellsFor(view.classId, view.subclass, view.level, extras, view.features)], names),
  );
}

// What each ritual caster casts as a ritual (SRD 5.1, each class's Ritual
// Casting): a wizard any ritual in the book, prepared or not; a cleric or
// druid (and ODM's artificer) a prepared one; a bard a known one. A
// subclass's always-prepared spells are prepared. Ritual Caster's book and
// the warlock's Book of Ancient Secrets are the sheet's spellbook, rituals
// only, whatever the class. Undefined: nothing holds it at all.
function ritualHolderProblem(
  sheet: Caster,
  views: ReturnType<typeof casterViewsOf>,
  names: Set<string>,
  spell: string,
  extras?: SubclassExtras,
): ToolError | null | undefined {
  const ritualViews = views.filter((view) => RITUAL_CASTERS.has(view.classId.trim().toLowerCase()));
  const holds = (view: (typeof views)[number]) =>
    hasName([...view.known, ...view.prepared, ...subclassSpellsFor(view.classId, view.subclass, view.level, extras, view.features)], names) ||
    (view.style === "spellbook" && hasName(spellbookOf(view), names));
  if (ritualViews.some(holds)) {
    return null;
  }
  // SRD 5.1, Pact of the Chain: "You learn the find familiar spell and can
  // cast it as a ritual."
  if (pactRitualOf(sheet, spell) && views.some(holds)) {
    return null;
  }
  const book = holdsFeat(sheet, "ritual caster") || holdsFeat(sheet, "book of ancient secrets");
  if (book && hasName(sheet.spellcasting?.spellbook, names)) {
    return null;
  }
  const other = views.find(holds);
  if (other) {
    return { error: `${sheet.name} holds ${spell} as a ${other.classId} spell, and a ${other.classId}'s Spellcasting does not cast rituals (bards, clerics, druids, wizards and artificers do, through their own spells). It can be cast from a slot instead.`, refused: "rules" };
  }
  if (book) {
    return { error: `${spell} is not written in ${sheet.name}'s ritual book, so it cannot be cast as a ritual. It goes in the book first (a ritual of a level they can cast, found and copied), or it is cast from a slot.`, refused: "rules" };
  }
  return undefined;
}

// ---- the caster's own state ----

export function casterStateProblem(sheet: Caster): ToolError | null {
  if (sheet.conditions.some((entry) => entry.trim().toLowerCase() === "raging")) {
    return { error: `${sheet.name} is raging and cannot cast spells or concentrate on them. They can cast once the rage ends.`, refused: "rules" };
  }
  if (sheet.wildShape) {
    const polymorphed = sheet.wildShape.kind === "polymorph";
    const beastSpells =
      !polymorphed &&
      holdsFeature(sheet, "Beast Spells");
    if (!beastSpells) {
      return { error: polymorphed
        ? `${sheet.name} is polymorphed into a ${sheet.wildShape.form} and cannot cast spells; the form has no capacity for it. The spell waits until the transformation ends.`
        : `${sheet.name} is wild shaped as a ${sheet.wildShape.form} and cannot cast spells in beast form, cantrips included (that unlocks with Beast Spells at druid level 18). They can revert with use_resource on Wild Shape.`, refused: "rules" };
    }
  }
  // SRD 5.1, Armor: armor worn without the training for it bars casting.
  if (wearsUntrainedArmor(sheet)) {
    const armor = acBreakdownFor(sheet);
    const worn = [armor.armorName, armor.shieldName].filter(Boolean).join(" and ");
    return { error: `${sheet.name} is wearing armor they are not trained in (${worn || "their armor"}) and cannot cast spells in it. They cast again once it is off.`, refused: "rules" };
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
    .filter((item: EquipmentItem) => item.equipped === true && matchWeapon(item) !== null)
    .reduce((sum, item) => sum + Math.max(1, item.qty ?? 1), 0);
  return Math.min(2, shield + weapons);
}

// Classes that may bear their spellcasting focus on a shield (a holy symbol
// as an emblem), which makes the shield hand the hand for a material.
const EMBLEM_BEARERS = new Set(["cleric", "paladin"]);

export function componentProblem(sheet: Caster, facts: SpellFacts | null): ToolError | null {
  if (!facts) {
    return null;
  }
  const mute = sheet.conditions.find((entry) => MUTE.includes(entry.trim().toLowerCase()));
  if (facts.verbal && mute) {
    return { error: `${facts.name} has a verbal component and ${sheet.name} is ${mute}: they cannot speak the words. A spell with no verbal component could still be cast.`, refused: "rules" };
  }
  if (!facts.somatic && !facts.material) {
    return null;
  }
  if (handsBusy(sheet) < 2) {
    return null;
  }
  // War Caster frees the gestures only; a material is still handled by a
  // hand (the same hand may make the gestures too), unless the focus is on
  // the shield (a cleric's or paladin's emblem) or is the staff, rod or wand
  // they wield.
  if (!facts.material) {
    return castsWithHandsFull(sheet)
      ? null
      : { error: `${facts.name} needs a free hand for its gestures, and both of ${sheet.name}'s hands are full. They must put a weapon away or lower the shield first (unequip it on the sheet).`, refused: "rules" };
  }
  const classIds = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  const emblem =
    Boolean(acBreakdownFor(sheet).shieldName) &&
    classIds.some((id) => EMBLEM_BEARERS.has(id.trim().toLowerCase()));
  const focusInHand = sheet.equipment.some(
    (item) => item.equipped === true && (hasItemTag(item, "staff") || hasItemTag(item, "rod") || hasItemTag(item, "wand")),
  );
  if (emblem || focusInHand) {
    return null;
  }
  return { error: `${facts.name} needs a free hand for its material component${facts.somatic ? " (the same hand makes the gestures)" : ""}, and both of ${sheet.name}'s hands are full${castsWithHandsFull(sheet) ? "; War Caster frees the gestures, not the material" : ""}. They must put a weapon away or lower the shield first (unequip it on the sheet).`, refused: "rules" };
}

// ---- a material that costs ----

// Structured components, carried worth and the purse (src/lib/dm/cast-materials.ts).
export { focusProblem, materialComponents, materialPlan } from "@/lib/dm/cast-materials";

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
      error: `${
        spell
          ? `${spell} is not a spell the server knows, so the slot level it is cast from must be named (1 to 9).`
          : "A spell slot has a level from 1 to 9; name the level to spend."
      } ${freeSlotsLine(casting, 1, true)} Ask the player which, unless they named one.`,
      retry: true,
    };
  }
  if (facts && level < facts.level) {
    return {
      error: `${facts.name} is a level ${facts.level} spell; it cannot be cast from a level ${level} slot. Use a slot of level ${facts.level} or higher. ${freeSlotsLine(casting, facts.level, true)} Ask the player which, unless they named one.`,
      retry: true,
    };
  }
  // Multiclass warlock: a Pact Magic slot of the right level is spent first
  // when the spell sits on the warlock entry's list (it comes back on a short
  // rest, so burning it before the shared pool is strictly kind); shared
  // slots are the fallback in both directions.
  const pact = casting?.pact;
  const warlock = casting?.casters?.find((caster) => caster.classId.trim().toLowerCase() === "warlock");
  // An invocation's once-a-rest spell is cast "using a warlock spell slot".
  const onWarlockList =
    !spell ||
    Boolean(warlock && hasName([...(warlock.cantrips ?? []), ...warlock.known, ...warlock.prepared], names)) ||
    grantedCastFor(grantSheet(sheet), names)?.slot === "slot";
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
  return spentSlotRefusal(sheet.name, casting, {
    level,
    lowest: facts && facts.level <= level ? facts.level : level,
    what: facts?.name ?? (spell || "the spell"),
    withPact: true,
  });
}

// ---- a slot level that is spent ----

// The slot levels still free at `lowest` or above, lowest first: the shared
// slots and, where the spend takes one, a Pact Magic slot, with how many of
// each are left.
function freeSlotLevels(casting: CharacterSheet["spellcasting"], lowest: number, withPact: boolean): Array<{ level: number; left: number }> {
  const free = new Map<number, number>();
  for (const [key, slot] of Object.entries(casting?.slots ?? {})) {
    const level = Number(key);
    if (level >= lowest && slot.used < slot.max) {
      free.set(level, slot.max - slot.used);
    }
  }
  const pact = casting?.pact;
  if (withPact && pact && pact.level >= lowest && pact.used < pact.max) {
    free.set(pact.level, (free.get(pact.level) ?? 0) + pact.max - pact.used);
  }
  return [...free].sort(([a], [b]) => a - b).map(([level, left]) => ({ level, left }));
}

// The free slot levels as every slot refusal names them.
export function freeSlotsLine(casting: CharacterSheet["spellcasting"], lowest: number, withPact: boolean): string {
  const free = freeSlotLevels(casting, lowest, withPact);
  return free.length
    ? `Free slots, lowest first: ${free.map((entry) => `level ${entry.level} (${entry.left} left)`).join(", ")}.`
    : "No slot is free.";
}

// A slot level that is spent (the one named, or the spell's own). The caster
// chooses the slot, "of that spell's level or higher": with a usable level
// still free, the levels are named for the player to pick, lowest first; with
// none, the game says no (`none` overrides that refusal).
export function spentSlotRefusal(
  who: string,
  casting: CharacterSheet["spellcasting"],
  input: { level: number; lowest: number; what: string; withPact: boolean; none?: ToolError },
): ToolError {
  if (freeSlotLevels(casting, input.lowest, input.withPact).length) {
    return {
      error: `${who} has no free level ${input.level} spell slot for ${input.what}. ${freeSlotsLine(casting, input.lowest, input.withPact)} Ask the player which, unless they named one.`,
      retry: true,
    };
  }
  return (
    input.none ?? {
      error: `${who} has no spell slot of level ${input.lowest} or higher left for ${input.what}; spent slots come back on a long rest (a Pact Magic slot on a short one).`,
      refused: "rules",
    }
  );
}

// ---- rituals ----

// A ritual in a fight is no refusal: its ten extra minutes make it a casting
// held across the caster's turns (src/lib/dm/long-casting-logic.ts).
export function ritualProblem(
  sheet: Caster,
  spell: string,
  facts: SpellFacts | null,
): ToolError | null {
  if (!spell) {
    return { error: "A ritual is a named spell with the ritual tag; name the spell being cast.", retry: true };
  }
  if (!facts) {
    return { error: `${spell} is not a spell the server knows to be a ritual; it needs a slot.`, retry: true };
  }
  if (!facts.ritual) {
    return { error: `${facts.name} has no ritual tag; it cannot be cast as a ritual and needs a slot.`, refused: "rules" };
  }
  if (!canCastRituals(sheet) && !pactRitualOf(sheet, facts.name)) {
    return { error: `${sheet.name}'s class does not cast rituals (bards, clerics, druids and wizards do); ${facts.name} needs a slot.`, refused: "rules" };
  }
  return null;
}

// ---- the turn ----

// What the turn budget remembers of the spells cast this turn, kept in its
// once-per-turn list so the budget's own shape stays as it is.
export const BONUS_SPELL = "spell:bonus-action";
// Any spell but a cantrip of one action: a levelled spell, or a reaction
// spell cast on the caster's own turn.
export const LEVELLED_SPELL = "spell:levelled";
// Quickened Spell (sorcerer Metamagic, 2 sorcery points) paid this turn:
// the next spell with a casting time of one action takes the bonus action.
export const QUICKENED = "metamagic:quickened";
// A one-action spell a feature lets the caster cast with the bonus action
// instead (issue 233): Mantle of Majesty's Command every turn ("always"),
// Elder Champion's paladin spells once the action is gone ("spare"), and an
// enchantment spell after a use of Embodiment of the Law paid this turn
// ("mark", the budget key it left).
export type BonusCast = {
  feature: string;
  mode: "always" | "spare" | "mark";
  mark?: string;
  // The feature casts the cantrip as a bonus action after a levelled spell,
  // which the bonus-action spell rule would otherwise refuse.
  afterLevelled?: boolean;
};
export const EMBODIMENT_MARK = "bonus-cast:embodiment of the law";
// The genre classes' "cast a cantrip as a bonus action after casting a
// leveled ..." (Surge Casting, Surge Momentum, Surge of Change, The Rite
// Remembers), paid for by a use this turn.
export const SURGE_MARK = "bonus-cast:surge";
export const SURGE_FEATURES = ["surge casting", "surge momentum", "surge of change", "the rite remembers"];
export const MANTLE_OF_MAJESTY = "mantle of majesty";

// The feature that lets this one-action spell take the bonus action, when
// one does. `school` is the spell's school when the caller knows it.
export function bonusCastOf(
  sheet: Pick<CharacterSheet, "conditions" | "features">,
  facts: SpellFacts | null,
  school: string | null,
): BonusCast | null {
  if (!facts || facts.castingTime !== "action") {
    return null;
  }
  const holding = (name: string) => sheet.conditions.some((entry) => isConditionNamed(entry, name));
  const engine = (facts.runsAs ?? facts.name).trim();
  if (holding(MANTLE_OF_MAJESTY) && /^command$/i.test(engine)) {
    return { feature: "Mantle of Majesty", mode: "always" };
  }
  if (holding("elder champion") && facts.classes.some((entry) => entry.toLowerCase() === "paladin")) {
    return { feature: "Elder Champion", mode: "spare" };
  }
  // Only a use of the surge leaves its mark, so a cantrip asks the mark.
  if (facts.level === 0) {
    const surge = sheet.features.find((feature) => SURGE_FEATURES.includes(textKey(feature.name)));
    return { feature: surge?.name.trim() ?? "The surge", mode: "mark", mark: SURGE_MARK, afterLevelled: true };
  }
  const embodies = sheet.features.some((feature) => textKey(feature.name) === "embodiment of the law");
  if (embodies && facts.level >= 1 && school === "enchantment") {
    return { feature: "Embodiment of the Law", mode: "mark", mark: EMBODIMENT_MARK };
  }
  return null;
}
const SHARES = "cast-shares";

// A casting whose attack rolls, darts or targets are resolved one call at a
// time (Eldritch Blast's beams, Scorching Ray, Bane on three creatures): how
// many the casting still holds, and the slot it was cast from. An area
// resolved a creature per call keeps who it has caught and its one damage
// roll (cast-at-enemy.ts), so every call is the same placement and the same
// dice.
export type OpenCast = { spell: string; slotLevel: number | null; left: number; caught?: string[]; roll?: number };

export function openCastOf(budget: TurnBudget | null, spell: string): OpenCast | null {
  const wanted = textKey(spell);
  for (const entry of budget?.oncePerTurn ?? []) {
    const [tag, name, slot, left, caught, roll] = entry.split("|");
    if (tag === SHARES && name === wanted && Number(left) > 0) {
      return {
        spell: wanted,
        slotLevel: slot === "-" ? null : Number(slot),
        left: Number(left),
        ...(caught ? { caught: caught.split(",") } : {}),
        ...(roll && roll !== "-" ? { roll: Number(roll) } : {}),
      };
    }
  }
  return null;
}

export function withOpenCast(budget: TurnBudget, open: OpenCast): TurnBudget {
  const wanted = textKey(open.spell);
  const kept = budget.oncePerTurn.filter((entry) => {
    const [tag, name] = entry.split("|");
    return !(tag === SHARES && name === wanted);
  });
  return {
    ...budget,
    oncePerTurn:
      open.left > 0
        ? [...kept, [SHARES, wanted, open.slotLevel ?? "-", open.left, (open.caught ?? []).join(","), open.roll ?? "-"].join("|")]
        : kept,
  };
}

export type TurnCharge =
  | { kind: "free" }
  | { kind: "budget"; budget: TurnBudget; cost: "action" | "bonus action"; note?: string }
  | { kind: "reaction"; budget?: TurnBudget };

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
  bonusCast?: BonusCast | null;
}): TurnCharge | CastRefusal {
  const { who, facts, budget, inFight } = input;
  const name = facts?.name ?? input.spell;
  if (!inFight) {
    return { kind: "free" };
  }
  const marks = budget?.oncePerTurn ?? [];
  const printed = facts?.castingTime ?? "action";
  const quickened = printed === "action" && marks.includes(QUICKENED);
  const bonusCast = input.bonusCast;
  const featured =
    printed === "action" && !quickened && bonusCast
      ? bonusCast.mode === "always" ||
        (bonusCast.mode === "spare" && Boolean(budget?.actionUsed) && !(budget?.grantedActions ?? 0)) ||
        (bonusCast.mode === "mark" && Boolean(bonusCast.mark) && marks.includes(bonusCast.mark!))
      : false;
  const time = quickened || featured ? "bonus" : printed;
  const levelled = (facts ? facts.level : (input.slotLevel ?? 0)) > 0;
  // SRD 5.1, Casting Time, Bonus Action: a spell cast with a bonus action
  // leaves the turn room for one other spell only, a cantrip with a casting
  // time of one action.
  if (time === "bonus" && marks.includes(LEVELLED_SPELL) && !(featured && bonusCast?.afterLevelled)) {
    return {
      error: `${who} has already cast a levelled spell this turn, so ${name} cannot be cast with the bonus action: beside a bonus action spell the only other spell of the turn is a cantrip.`,
      refused: "rules",
    };
  }
  if (time !== "bonus" && levelled && marks.includes(BONUS_SPELL)) {
    return {
      error: `${who} has cast a spell with their bonus action this turn, so the only other spell they can cast is a cantrip with a casting time of one action. ${name} waits for another turn.`,
      refused: "rules",
    };
  }
  if (time === "reaction") {
    if (input.reactionSpent) {
      return {
        error: `${who} has already used their reaction; it comes back at the start of their next turn. ${name} is not cast.`,
        refused: "rules",
      };
    }
    const own = reactionSpellOnOwnTurn(budget, who, name);
    if ("error" in own) {
      return own;
    }
    return { kind: "reaction", ...(own.budget ? { budget: own.budget } : {}) };
  }
  if (!budget) {
    return { kind: "free" };
  }
  const mark = (next: TurnBudget): TurnBudget => ({
    ...next,
    oncePerTurn: [
      ...next.oncePerTurn.filter((entry) => !(quickened && entry === QUICKENED) && !(featured && entry === bonusCast?.mark)),
      ...(time === "bonus" && !next.oncePerTurn.includes(BONUS_SPELL) ? [BONUS_SPELL] : []),
      ...(time !== "bonus" && levelled && !next.oncePerTurn.includes(LEVELLED_SPELL) ? [LEVELLED_SPELL] : []),
    ],
  });
  const spent =
    time === "bonus"
      ? spendAction(budget, "bonus", `casting ${name}`, who)
      : spendCastAttack(budget, name, who);
  if (!spent.ok) {
    return toolError(spent);
  }
  const note = [
    spent.note,
    quickened ? `Quickened Spell: ${name} took the bonus action instead of the action.` : "",
    featured ? `${bonusCast!.feature}: ${name} took the bonus action instead of the action.` : "",
  ].filter(Boolean).join(" ");
  return {
    kind: "budget",
    budget: mark(spent.budget),
    cost: time === "bonus" ? "bonus action" : "action",
    ...(note ? { note } : {}),
  };
}

// SRD 5.1, Casting Time, Bonus Action: the limit is on the turn, whatever
// the spell is cast with. A reaction spell on the caster's own turn (Shield
// against an opportunity attack, Absorb Elements against a trap) is the
// turn's other spell: it cannot follow a bonus action spell, and it bars
// one after it. `budget` is the live budget of the caster's own turn, or
// null on anyone else's turn, when the rule does not reach.
export function reactionSpellOnOwnTurn(
  budget: TurnBudget | null,
  who: string,
  name: string,
): CastRefusal | { budget: TurnBudget | null } {
  if (!budget) {
    return { budget: null };
  }
  if (budget.oncePerTurn.includes(BONUS_SPELL)) {
    return {
      error: `${who} has cast a spell with their bonus action this turn, so the only other spell they can cast on it is a cantrip with a casting time of one action; ${name} on their own turn is not one.`,
      refused: "rules",
    };
  }
  return {
    budget: budget.oncePerTurn.includes(LEVELLED_SPELL) ? budget : { ...budget, oncePerTurn: [...budget.oncePerTurn, LEVELLED_SPELL] },
  };
}
