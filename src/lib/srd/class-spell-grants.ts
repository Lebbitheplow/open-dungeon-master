// Spells a class feature lets a caster take from beyond its class's spell
// list, or hold beyond its class's counts (issue #570, the SRD text audit,
// CLS-19 to CLS-22). SRD 5.1:
//
// - Bard, Magical Secrets (10th, 14th and 18th level): "Choose two spells
//   from any classes, including this one. A spell you choose must be of a
//   level you can cast ... or a cantrip. The chosen spells count as bard
//   spells for you and are included in the number in the Spells Known column."
// - College of Lore, Additional Magical Secrets (6th): "you learn two spells
//   of your choice from any class ... but don't count against the number of
//   bard spells you know."
// - Warlock, Pact of the Tome: "choose three cantrips from any class's spell
//   list ... They don't count against your number of cantrips known."
// - Warlock, Pact of the Chain: "You learn the find familiar spell and can
//   cast it as a ritual. The spell doesn't count against your number of
//   spells known."
//
// Before this every list check refused a bard's Fireball as "not on the bard
// spell list", and docs/rules-coverage.md said the spells landed on the
// sheet. Nothing on a sheet records which spell came through which of these
// features: a spell off the class's list stands for one, so the off-list
// spells a caster keeps are counted against the features' number instead.
//
// Pure and import-light: the level-up route, the creation check and the
// level-up dialog all read it.
import { chosenOptions } from "@/lib/srd/options";
import { holdsFeature } from "@/lib/srd/feature-names";
import { subclassNamedBare } from "@/lib/srd/subclass-name";
import { textKey } from "@/lib/language/text-logic";

export type ClassSpellGrants = {
  // Spells (or cantrips) this caster may take from any class's list.
  anyList: number;
  // Whether the any-list picks may be levelled spells too, or cantrips only
  // (the Book of Shadows).
  anyListSpells: boolean;
  // Held on top of the class's spells known (Additional Magical Secrets).
  extraSpells: number;
  // Held on top of the class's cantrips known (the Book of Shadows).
  extraCantrips: number;
  // Learned outright, free of the list and the count (find familiar).
  learned: string[];
  // The feature the any-list picks come from, for a refusal to name.
  feature: string;
};

const NONE: ClassSpellGrants = { anyList: 0, anyListSpells: false, extraSpells: 0, extraCantrips: 0, learned: [], feature: "" };

type GrantView = {
  classId: string;
  level: number;
  subclass?: string;
  features?: ReadonlyArray<{ name: string }>;
};

// Magical Secrets' spells by bard level: two at 10th, 14th and 18th.
function magicalSecrets(level: number): number {
  return level >= 18 ? 6 : level >= 14 ? 4 : level >= 10 ? 2 : 0;
}

export function classSpellGrants(view: GrantView): ClassSpellGrants {
  const classId = textKey(view.classId);
  const features = [...(view.features ?? [])];
  if (classId === "bard") {
    const secrets = magicalSecrets(view.level);
    // The College of Lore's two, or a workshop subclass that borrowed the
    // feature by name.
    const lore =
      view.level >= 6 &&
      (subclassNamedBare(view.subclass ?? "", "College of Lore") || holdsFeature({ features }, "Additional Magical Secrets"))
        ? 2
        : 0;
    if (!secrets && !lore) {
      return NONE;
    }
    return {
      ...NONE,
      anyList: secrets + lore,
      anyListSpells: true,
      extraSpells: lore,
      feature: secrets && lore ? "Magical Secrets and Additional Magical Secrets" : secrets ? "Magical Secrets" : "Additional Magical Secrets",
    };
  }
  if (classId === "warlock" && view.level >= 3) {
    const boons = chosenOptions(features, "pact_boon").map(textKey);
    const tome = boons.includes("pact of the tome");
    const chain = boons.includes("pact of the chain");
    if (!tome && !chain) {
      return NONE;
    }
    return {
      ...NONE,
      anyList: tome ? 3 : 0,
      extraCantrips: tome ? 3 : 0,
      learned: chain ? ["Find Familiar"] : [],
      feature: tome ? "Pact of the Tome" : "",
    };
  }
  return NONE;
}

// Whether a Pact of the Chain warlock casts this spell as a ritual: find
// familiar is the one the pact names.
export function pactRitualOf(sheet: { classes?: ReadonlyArray<{ id: string; level: number }>; class: string; level: number; features?: ReadonlyArray<{ name: string }> }, spell: string): boolean {
  const entries = sheet.classes?.length ? sheet.classes : [{ id: sheet.class, level: sheet.level }];
  return entries.some((entry) =>
    classSpellGrants({ classId: entry.id, level: entry.level, features: sheet.features }).learned.some(
      (name) => textKey(name) === textKey(spell),
    ),
  );
}

// The refusals for off-list picks past what the features allow, empty when
// the picks fit. `kept` is how many off-list spells the caster already held
// (counted up to what the features allowed then), `strays` the new ones. A
// pick no feature takes in is refused on its own, as every list check did.
export function offListProblems(input: {
  grants: ClassSpellGrants;
  // The features' number before this change (the same number at creation).
  allowedBefore: number;
  kept: number;
  strays: Array<{ name: string; cantrip: boolean }>;
  list: string;
  label: string;
}): string[] {
  const { grants } = input;
  const offList = (stray: { name: string; cantrip: boolean }) =>
    stray.cantrip
      ? `${stray.name} is not a ${input.list} cantrip, so a ${input.label} cannot learn it`
      : `${stray.name} is not on the ${input.list} spell list, so a ${input.label} cannot learn or prepare it`;
  const takes = (stray: { cantrip: boolean }) => grants.anyList > 0 && (stray.cantrip || grants.anyListSpells);
  const problems = input.strays.filter((stray) => !takes(stray)).map((stray) => `${offList(stray)}.`);
  const taken = input.strays.filter(takes);
  const used = Math.min(input.allowedBefore, input.kept);
  if (taken.length && used + taken.length > grants.anyList) {
    problems.push(
      `${offList(taken[0])}: through ${grants.feature} a ${input.label} holds ${grants.anyList} ${grants.anyListSpells ? "spells" : "cantrips"} from other classes' lists, and this would make ${used + taken.length}.`,
    );
  }
  return problems;
}
