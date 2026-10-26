// A workshop species' choice of packages (a Half-Dragon's ancestry): which
// option the sheet holds, and the race the rest of the check reads once that
// option is folded in (src/lib/content/species-variants.ts).
//
// A character made or edited here names one of the options the species
// offers today; a file older than the choice owes it, as it owes a feat's
// picks; a stored character keeps the one it was made with, even an option
// since removed, since its features and scores already carry it; a companion
// the engine drafts rolls one, as it rolls a dragonborn's ancestry.
import { textKey } from "@/lib/language/text-logic";
import { variantFeatureNames, withSpeciesVariant, type SpeciesVariantOption } from "@/lib/content/species-variants";
import type { Proficiencies } from "@/lib/schemas/sheet";
import { lower, type Door, type RaceGrants } from "@/lib/srd/legality/types";

export type SpeciesVariantVerdict = {
  // The race with the option's scores, skills, tools and languages added.
  race: RaceGrants;
  option: SpeciesVariantOption | null;
  // The race features the option is written as.
  traits: string[];
  // What racialChoices.variant keeps.
  variant: string;
  problems: string[];
  owed: string[];
};

export function judgeSpeciesVariant(input: {
  race: RaceGrants;
  picked: string;
  door: Door;
  made: boolean;
  edit: boolean;
  trustsHeld: boolean;
  judgesPicks: boolean;
  picksMayWait: boolean;
  rollDie: (sides: number) => number;
}): SpeciesVariantVerdict {
  const { race: base, picked, door } = input;
  const group = base.variants;
  const problems: string[] = [];
  const owed: string[] = [];
  let option = group?.options.find((entry) => entry.id === picked) ?? null;
  if (group) {
    const kind = group.label.toLowerCase();
    const list = group.options.map((entry) => entry.name).join(", ");
    if (picked && !option && !input.trustsHeld) {
      problems.push(`"${picked}" is not a ${kind} the ${base.name} offers; pick one of ${list}.`);
    } else if (!option && door === "engine") {
      const face = Math.max(1, Math.min(group.options.length, input.rollDie(group.options.length)));
      option = group.options[face - 1];
    } else if (!option && (input.made || input.edit)) {
      problems.push(`A ${base.name} chooses a ${kind}: one of ${list}.`);
    } else if (!option && !picked && input.picksMayWait) {
      owed.push(`${base.name}: pick a ${kind} (${list}).`);
    }
  } else if (picked && input.judgesPicks) {
    problems.push(`The ${base.name} offers no choice like "${picked}"; remove it.`);
  }
  return {
    race: option ? withSpeciesVariant(base, option.id) : base,
    option,
    traits: option && group ? variantFeatureNames(group.label, option, base.traitNames) : [],
    // A stored character's pick stays as it was made, an option since
    // removed included; anyone else's is the option found, or none.
    variant: option?.id ?? (input.trustsHeld ? picked : ""),
    problems,
    owed,
  };
}

// The training a stored character holds, without what its old option gave
// when an edit picks another: "what the character holds stays with it" is
// for what it earned, and an option given up is not that.
export function withoutOldVariant(
  held: Proficiencies,
  race: RaceGrants,
  heldVariant: string | undefined,
  variant: string,
): Proficiencies {
  const old = (heldVariant ?? "").trim();
  const option = old && old !== variant ? race.variants?.options.find((entry) => entry.id === old) : undefined;
  if (!option) {
    return held;
  }
  const skills = new Set((option.skills ?? []).map(lower));
  const tools = new Set((option.tools ?? []).map(textKey));
  const languages = new Set((option.languages ?? []).map(textKey));
  return {
    ...held,
    skills: held.skills.filter((skill) => !skills.has(lower(skill))),
    tools: held.tools.filter((tool) => !tools.has(textKey(tool))),
    languages: held.languages.filter((language) => !languages.has(textKey(language))),
  };
}
