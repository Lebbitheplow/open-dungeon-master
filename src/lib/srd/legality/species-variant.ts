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
import {
  heldVariantGrants,
  variantFeatureNames,
  variantGrantsOf,
  withSpeciesVariant,
  type SpeciesVariantGrants,
  type SpeciesVariantOption,
} from "@/lib/content/species-variants";
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
  // What racialChoices.variantGrants keeps: what the option admitted here
  // gives, or for a stored character what it was given (absent on a sheet
  // stored before the field).
  grants: Required<SpeciesVariantGrants> | undefined;
  problems: string[];
  owed: string[];
};

export function judgeSpeciesVariant(input: {
  race: RaceGrants;
  picked: string;
  // What the stored character's option gave it, as the sheet records it.
  heldGrants?: Required<SpeciesVariantGrants>;
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
    // Likewise what it gave: a stored character keeps the record of what
    // its scores and training carry; anyone else's is written afresh from
    // the option admitted, never read from the request.
    grants: input.trustsHeld ? input.heldGrants : option ? variantGrantsOf(option) : undefined,
    problems,
    owed,
  };
}

// The training a stored character holds, without what its old option gave
// that the option picked now does not: "what the character holds stays with
// it" is for what it earned, and an option given up, or a grant the author
// has since taken out of it, is not that. What it gave is the sheet's own
// record of it; a sheet stored before that record reads the option of its id
// the species offers today, and only when the edit picks another.
export function withoutOldVariant(
  held: Proficiencies,
  race: RaceGrants,
  heldChoices: { variant?: string; variantGrants?: SpeciesVariantGrants } | undefined,
  picked: SpeciesVariantOption | null,
): Proficiencies {
  const old = heldVariantGrants(race, heldChoices);
  if (!old || (!heldChoices?.variantGrants && (heldChoices?.variant ?? "").trim() === (picked?.id ?? ""))) {
    return held;
  }
  // What the old option gave and the picked one does not.
  const takenOff = (gave: string[] | undefined, gives: string[] | undefined, key: (entry: string) => string) => {
    const kept = new Set((gives ?? []).map(key));
    return new Set((gave ?? []).map(key).filter((entry) => !kept.has(entry)));
  };
  const skills = takenOff(old.skills, picked?.skills, lower);
  const tools = takenOff(old.tools, picked?.tools, textKey);
  const languages = takenOff(old.languages, picked?.languages, textKey);
  return {
    ...held,
    skills: held.skills.filter((skill) => !skills.has(lower(skill))),
    tools: held.tools.filter((tool) => !tools.has(textKey(tool))),
    languages: held.languages.filter((language) => !languages.has(textKey(language))),
  };
}
