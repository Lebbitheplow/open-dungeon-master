// How the builder's class casts at the level being built, in one place for
// the three readers that decide it (useBuilderDerived.ts, reconcile.ts and
// submit.ts).
//
// Each of them read `klass.spellAbility`, which a fighter and a rogue do not
// have, so an Eldritch Knight or an Arcane Trickster was built with no spells
// at all while the server allows two cantrips and three spells at 3rd level
// (U:UB1). A third caster casts with Intelligence from the wizard's list and
// knows its spells; its counts and slots come from the engine's own tables
// (src/lib/srd/third-caster.ts through spell-prep.ts and spellSlotsFor).
import { spellClassFor } from "@/lib/classes";
import { suggestedCantripCount, suggestedSpellCount } from "@/lib/content/mechanics";
import type { AbilityScores } from "@/lib/schemas/sheet";
import { abilityMod, formatModifier, spellSlotsFor } from "@/lib/srd";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { cantripCapOf, spellCapOf } from "@/lib/srd/spell-prep";
import { thirdCasterAbility, thirdCasterList, thirdCasterProfileOf, type ThirdCasterProfile } from "@/lib/srd/third-caster";
import { subclassCastingProfileFor } from "@/lib/srd/features";

type CastingClass = {
  id: string;
  spellAbility?: string | null;
  casterType?: string;
};

export type BuilderCasting = {
  third: boolean;
  // Whose rules a third caster casts by: the Eldritch Knight's or the
  // Arcane Trickster's (its schools, its cantrips, its suggestions).
  profile: ThirdCasterProfile | null;
  ability: "int" | "wis" | "cha" | null;
  // The spell list searched (the borrowed SRD list for a setting class).
  list: string;
  maxSpellLevel: number;
  cantripCap: number | null;
  // A class that casts, and has something to cast at this level. A level 1
  // paladin has an ability and nothing to cast yet.
  casts: boolean;
};

export function builderCasting(
  klass: CastingClass | undefined | null,
  subclass: string | undefined | null,
  level: number,
): BuilderCasting {
  if (!klass) {
    return { third: false, profile: null, ability: null, list: "", maxSpellLevel: 0, cantripCap: null, casts: false };
  }
  const profile = thirdCasterProfileOf(klass.id, subclass, subclassCastingProfileFor(klass.id, subclass ?? ""));
  const third = profile !== null;
  const ability = (profile ? thirdCasterAbility(profile) : klass.spellAbility || null) as BuilderCasting["ability"];
  const list = profile ? thirdCasterList(profile) : spellClassFor(klass.id);
  const maxSpellLevel =
    third || klass.casterType !== "none"
      ? Object.keys(spellSlotsFor(klass.id, level, subclass, profile)).reduce((top, slot) => Math.max(top, Number(slot)), 0)
      : 0;
  const cantripCap = !ability
    ? null
    : third
      ? cantripCapOf({ classId: klass.id, level, subclass: subclass ?? "", progression: profile })
      : suggestedCantripCount(list, level, klass.casterType as Parameters<typeof suggestedCantripCount>[2]);
  const casts = Boolean(ability) && (maxSpellLevel > 0 || cantripCap !== null);
  return { third, profile, ability, list, maxSpellLevel, cantripCap: casts ? cantripCap : null, casts };
}

// How many levelled spells the class may hold at this level.
export function builderSpellAdvice(
  casting: BuilderCasting,
  klass: CastingClass,
  subclass: string | undefined | null,
  level: number,
  abilities: AbilityScores,
): { label: string; count: number; formula?: string } | null {
  if (!casting.casts || !casting.ability) {
    return null;
  }
  // No slot to cast a levelled spell with yet (a setting half caster at
  // level 1 that borrows a full caster's list): nothing to hold, so nothing
  // to ask for. The spell step offers no level 1 spell until there is a slot.
  if (casting.maxSpellLevel === 0) {
    return null;
  }
  if (casting.third) {
    return spellCapOf(
      {
        classId: klass.id,
        ability: casting.ability,
        level,
        subclass: subclass ?? "",
        progression: casting.profile ?? undefined,
        style: "known",
        known: [],
        prepared: [],
        cantrips: [],
        pending: [],
        spellbook: [],
      },
      abilities,
    );
  }
  const mod = abilityMod(abilities[casting.ability]);
  const advice = suggestedSpellCount(casting.list, level, mod);
  if (!advice || advice.label !== "spells prepared") {
    return advice;
  }
  return { ...advice, formula: preparedFormula(casting.ability, mod, casting.list, level) };
}

// How a prepared caster's count is worked out, said in the limit note so the
// number is not a mystery: "Wisdom modifier (+2) + level (3)". The level part
// is read back from the engine's own count with a modifier too large to hit
// the floor of one, so the half casters' rounding is never restated here.
export function preparedFormula(ability: "int" | "wis" | "cha", mod: number, list: string, level: number): string {
  const levelPart = (suggestedSpellCount(list, level, 100)?.count ?? 100) - 100;
  const levelWords = levelPart === level ? `level (${level})` : `half your level, rounded down (${levelPart})`;
  const sum = `${ABILITY_NAMES[ability]} modifier (${formatModifier(mod)}) + ${levelWords}`;
  return mod + levelPart < 1 ? `${sum}, and never fewer than 1` : sum;
}

// The slots the sheet is saved with, {level: {max, used}}: the preview, the
// build math table and the save all read this one (submit.ts), so the slots
// shown are the slots stored.
export function builderSpellSlots(
  klass: CastingClass | undefined | null,
  subclass: string | undefined | null,
  level: number,
): Record<string, { max: number; used: number }> {
  if (!klass) {
    return {};
  }
  const casting = builderCasting(klass, subclass, level);
  return Object.fromEntries(
    Object.entries(spellSlotsFor(klass.id, level, subclass, casting.profile)).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: 0 },
    ]),
  );
}
