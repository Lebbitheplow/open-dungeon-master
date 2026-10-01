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
import { abilityMod, spellSlotsFor } from "@/lib/srd";
import { cantripCapOf, spellCapOf } from "@/lib/srd/spell-prep";
import { THIRD_CASTER_ABILITY, THIRD_CASTER_LIST, isThirdCaster } from "@/lib/srd/third-caster";

type CastingClass = {
  id: string;
  spellAbility?: string | null;
  casterType?: string;
};

export type BuilderCasting = {
  third: boolean;
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
    return { third: false, ability: null, list: "", maxSpellLevel: 0, cantripCap: null, casts: false };
  }
  const third = isThirdCaster(klass.id, subclass);
  const ability = (third ? THIRD_CASTER_ABILITY : klass.spellAbility || null) as BuilderCasting["ability"];
  const list = third ? THIRD_CASTER_LIST : spellClassFor(klass.id);
  const maxSpellLevel =
    third || klass.casterType !== "none"
      ? Object.keys(spellSlotsFor(klass.id, level, subclass)).reduce((top, slot) => Math.max(top, Number(slot)), 0)
      : 0;
  const cantripCap = !ability
    ? null
    : third
      ? cantripCapOf({ classId: klass.id, level, subclass: subclass ?? "" })
      : suggestedCantripCount(list, level, klass.casterType as Parameters<typeof suggestedCantripCount>[2]);
  const casts = Boolean(ability) && (maxSpellLevel > 0 || cantripCap !== null);
  return { third, ability, list, maxSpellLevel, cantripCap: casts ? cantripCap : null, casts };
}

// How many levelled spells the class may hold at this level.
export function builderSpellAdvice(
  casting: BuilderCasting,
  klass: CastingClass,
  subclass: string | undefined | null,
  level: number,
  abilities: AbilityScores,
): { label: string; count: number } | null {
  if (!casting.casts || !casting.ability) {
    return null;
  }
  if (casting.third) {
    return spellCapOf(
      {
        classId: klass.id,
        ability: casting.ability,
        level,
        subclass: subclass ?? "",
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
  return suggestedSpellCount(casting.list, level, abilityMod(abilities[casting.ability]));
}
