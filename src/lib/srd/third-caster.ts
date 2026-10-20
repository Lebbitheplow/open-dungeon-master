// The two subclasses that cast at a third of a full caster's pace: the
// fighter's Eldritch Knight and the rogue's Arcane Trickster. Neither is in
// SRD 5.1; ODM ships both (src/lib/srd/subclasses.json), so their tables are
// here in the SRD's own shape. Import-free, so src/lib/srd/index.ts and the
// multiclass table can both read it without a cycle.
//
// The rules are a profile, not a class: a workshop subclass of any class
// that casts nothing of its own (a barbarian's, a monk's) may cast by any
// of them (src/lib/srd/subclass-tables.ts castingProfileOf). The published
// two are the fighter's and the rogue's by name; the content pack's
// third-caster subclasses (Tome of Heroes' Soulspy and Underfoot, and the
// pack's copies of the two) cast by theirs.

import { textKey } from "@/lib/language/text-logic";

export type ThirdCasterProfile = "eldritch-knight" | "arcane-trickster" | "soulspy" | "underfoot";
// What a sheet or a workshop subclass may store: a profile, or
// "third-caster", the first spelling (#415), which reads as the class's own
// (the rogue's Arcane Trickster, anyone else's Eldritch Knight).
export type ThirdCasterSetting = ThirdCasterProfile | "third-caster";

type ProfileRules = {
  // The published subclass's Spellcasting feature, by the name the bundled
  // tables and the workshop's feature catalog give it.
  feature?: string;
  label: string;
  who: string;
  // The class list it learns from, and the ability it casts with.
  list: string;
  ability: "int" | "wis" | "cha";
  // The two schools its levelled spells come from.
  schools: [string, string];
  // Cantrips known at 3rd level, one more at 10th: two, or three with the
  // Arcane Trickster's Mage Hand or the Underfoot's Shillelagh.
  cantrips: number;
};

const PROFILES: Record<ThirdCasterProfile, ProfileRules> = {
  "eldritch-knight": {
    feature: "Spellcasting (Eldritch Knight)",
    label: "Eldritch Knight",
    who: "An Eldritch Knight",
    list: "wizard",
    ability: "int",
    schools: ["abjuration", "evocation"],
    cantrips: 2,
  },
  "arcane-trickster": {
    feature: "Spellcasting (Arcane Trickster)",
    label: "Arcane Trickster",
    who: "An Arcane Trickster",
    list: "wizard",
    ability: "int",
    schools: ["enchantment", "illusion"],
    cantrips: 3,
  },
  soulspy: {
    label: "Soulspy",
    who: "A Soulspy",
    list: "cleric",
    ability: "wis",
    schools: ["abjuration", "necromancy"],
    cantrips: 3,
  },
  underfoot: {
    label: "Underfoot",
    who: "An Underfoot",
    list: "druid",
    ability: "wis",
    schools: ["divination", "transmutation"],
    cantrips: 3,
  },
};

const PROFILE_IDS = new Set<string>(Object.keys(PROFILES));

// The content pack's third-caster subclasses, by name: each prints the
// third-caster table and one of these profiles' rules in its prose.
const PACK_SUBCLASSES: Record<string, ThirdCasterProfile> = {
  "arcane warrior": "eldritch-knight",
  "eldritch trickster": "arcane-trickster",
  soulspy: "soulspy",
  underfoot: "underfoot",
};

export const THIRD_CASTER_PROFILES = (Object.keys(PROFILES) as ThirdCasterProfile[]).map((id) => ({
  id,
  label: PROFILES[id].label,
  list: PROFILES[id].list,
  ability: PROFILES[id].ability,
  schools: PROFILES[id].schools,
}));

// The published subclass each class casts as by name.
const BUNDLED: Record<string, { subclass: string; profile: ThirdCasterProfile }> = {
  fighter: { subclass: "eldritch knight", profile: "eldritch-knight" },
  rogue: { subclass: "arcane trickster", profile: "arcane-trickster" },
};

// Index = class level - 1; each row is slot levels 1 to 4.
const THIRD_SLOTS: number[][] = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3],
  [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2], [4, 3, 3],
  [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];

// Spells known by class level, index = level - 1.
const THIRD_SPELLS_KNOWN = [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

const FEATURE_PROFILE = new Map(
  (Object.keys(PROFILES) as ThirdCasterProfile[])
    .filter((id) => PROFILES[id].feature)
    .map((id) => [textKey(PROFILES[id].feature ?? ""), id]),
);

// The profile a content-pack subclass of this name casts by, or null.
export function thirdCasterProfileForPackSubclass(name: string): ThirdCasterProfile | null {
  return PACK_SUBCLASSES[textKey(name)] ?? null;
}

// The profile a feature of this name is the Spellcasting of. A workshop
// subclass that holds one (borrowed, or copied from the published subclass)
// casts by its rules unless its author turned that off.
export function thirdCasterProfileForFeature(name: string): ThirdCasterProfile | null {
  return FEATURE_PROFILE.get(textKey(name)) ?? null;
}

export function isThirdCasterFeature(name: string): boolean {
  return thirdCasterProfileForFeature(name) !== null;
}

// The class's own profile, for "third-caster" and for a caller that knows
// only that the class casts as a third caster.
export function defaultThirdCasterProfile(classId: string): ThirdCasterProfile {
  return BUNDLED[textKey(classId)]?.profile ?? "eldritch-knight";
}

export function isThirdCasterProfile(value: unknown): value is ThirdCasterProfile {
  return typeof value === "string" && PROFILE_IDS.has(value);
}

// Which rules this class and subclass cast by, or null: a stored setting
// first (a workshop subclass's, or the sheet's), then the published
// subclass by name. Callers check the class casts nothing of its own; a
// cleric's setting is never read as a second Spellcasting.
export function thirdCasterProfileOf(
  classId: string,
  subclass: string | undefined | null,
  setting?: string | null,
): ThirdCasterProfile | null {
  if (isThirdCasterProfile(setting)) {
    return setting;
  }
  if (setting === "third-caster") {
    return defaultThirdCasterProfile(classId);
  }
  const bundled = BUNDLED[textKey(classId)];
  return bundled && textKey(subclass ?? "") === bundled.subclass ? bundled.profile : null;
}

// Whether this class and subclass cast as a third caster.
export function isThirdCaster(classId: string, subclass: string | undefined | null, setting?: string | null): boolean {
  return thirdCasterProfileOf(classId, subclass, setting) !== null;
}

// The class list a third caster learns from and the ability it casts with.
export function thirdCasterList(profile: ThirdCasterProfile): string {
  return PROFILES[profile].list;
}

export function thirdCasterAbility(profile: ThirdCasterProfile): "int" | "wis" | "cha" {
  return PROFILES[profile].ability;
}

// Spell slots {level: max} at a class level; empty below 3rd.
export function thirdCasterSlots(level: number): Record<string, number> {
  const row = THIRD_SLOTS[Math.max(1, Math.min(20, Math.floor(level))) - 1] ?? [];
  return Object.fromEntries(row.map((max, index) => [String(index + 1), max]));
}

export function thirdCasterSpellsKnown(level: number): number {
  return THIRD_SPELLS_KNOWN[Math.max(1, Math.min(20, Math.floor(level))) - 1] ?? 0;
}

// Cantrips known from 3rd level, one more at 10th. `setting` is the profile
// when the caller has one; without it the class's own.
export function thirdCasterCantrips(classId: string, level: number, setting?: string | null): number {
  if (level < 3) {
    return 0;
  }
  const profile = thirdCasterProfileOf(classId, "", setting) ?? defaultThirdCasterProfile(classId);
  return PROFILES[profile].cantrips + (level >= 10 ? 1 : 0);
}

// The two schools each third caster learns its levelled spells from; any
// other school only with the picks the class allows from any school: one at
// 3rd level and one more at 8th, 14th and 20th. Cantrips are free of it.
export function thirdCasterAnySchoolPicks(level: number): number {
  return level >= 20 ? 4 : level >= 14 ? 3 : level >= 8 ? 2 : level >= 3 ? 1 : 0;
}

// A pack row's school is a word ("evocation") or, in the newer documents,
// an object ({ name: "Evocation", key: "evocation" }); either reads as the
// word. Reading the object as a string threw, and took the builder's spell
// step down for an Eldritch Knight or Arcane Trickster (issue 66).
function schoolWord(school: unknown): string {
  if (typeof school === "string") {
    return school;
  }
  if (school && typeof school === "object") {
    const { key, name } = school as { key?: unknown; name?: unknown };
    return typeof key === "string" ? key : typeof name === "string" ? name : "";
  }
  return "";
}

// How many of these levelled spells sit outside the profile's two schools
// (the class's own when no setting is given). A spell whose school nobody
// knows (homebrew without one) is not counted.
export function thirdCasterOutside(
  classId: string,
  spells: Array<{ school: unknown }>,
  setting?: string | null,
): number {
  const profile = thirdCasterProfileOf(classId, "", setting) ?? BUNDLED[textKey(classId)]?.profile;
  if (!profile) {
    return 0;
  }
  const schools = PROFILES[profile].schools;
  return spells.filter((spell) => {
    const school = textKey(schoolWord(spell.school));
    return Boolean(school) && !schools.includes(school);
  }).length;
}

// What is wrong with a third caster's levelled spells known: more from
// outside its two schools than its level allows. `heldOutside` is how many
// the stored sheet already held outside them, so a sheet written before this
// rule is not refused for keeping what it has, only for adding more. Null
// when nothing is wrong or the class casts no third-caster magic. The level
// up route, the sheet legality check and the level-up picker all ask this.
export function thirdCasterSchoolProblem(input: {
  classId: string;
  subclass: string | null | undefined;
  profile?: string | null;
  level: number;
  spells: Array<{ name: string; school: unknown }>;
  heldOutside?: number;
}): string | null {
  const profile = thirdCasterProfileOf(input.classId, input.subclass, input.profile);
  if (!profile) {
    return null;
  }
  const { schools, who } = PROFILES[profile];
  const outside = thirdCasterOutside(input.classId, input.spells, profile);
  const allowed = Math.max(thirdCasterAnySchoolPicks(input.level), input.heldOutside ?? 0);
  if (outside <= allowed) {
    return null;
  }
  const any = thirdCasterAnySchoolPicks(input.level);
  return `${who} of level ${input.level} learns ${schools[0]} and ${schools[1]} spells, and ${any} from any other school; this would make ${outside}. Pick an ${schools[0]} or ${schools[1]} spell instead.`;
}
