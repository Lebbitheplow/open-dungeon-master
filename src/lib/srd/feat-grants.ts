// What a feat hands over beyond its ability point: languages, skills,
// expertise, armor, weapons and tools, read from the feat's own text so a
// content pack's feats count as much as ODM's (issue #125: Linguist's three
// languages, Heavily Armored's armor and Skill Expert's skill were words on
// the sheet and nothing more, while the DM held the character to "only
// their listed languages"; issue #147: the Level Up and Tome of Heroes
// wordings, and a pick that may be a skill or a tool).
//
// A grant that leaves a choice (which three languages, which skill, which
// four weapons) is picked where the feat is picked and stored on the sheet
// as featChoices, keyed by the feat's name. The server applies the grants
// when the sheet is made, edited or levelled (src/lib/srd/sheet-legality.ts,
// src/lib/srd/level-up.ts); the builder applies them to its preview. The
// reading of the text is src/lib/srd/feat-grant-text.ts. Pure.
import type { Proficiencies } from "@/lib/schemas/sheet";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { featSpellsOwed, type CastingAbility } from "@/lib/srd/feat-spells";
import { featGrantSpec, featGrantsAnything, lowerText as lower, type FeatGrantSpec, type PickKind } from "@/lib/srd/feat-grant-text";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

export { featGrantSpec, featGrantsAnything, KNOWN_TOOLS, type FeatGrantSpec, type PickKind } from "@/lib/srd/feat-grant-text";

export type FeatPicks = {
  languages?: string[];
  skills?: string[];
  expertise?: string[];
  weapons?: string[];
  tools?: string[];
  // Armor a feat offers as a pick (shields).
  armor?: string[];
  // The spells a feat teaches (src/lib/srd/feat-spells.ts): the cantrips
  // and spells named, the class list and the casting ability where the
  // feat leaves those open.
  cantrips?: string[];
  spells?: string[];
  list?: string;
  ability?: CastingAbility;
  // Elemental Adept's damage type (src/lib/srd/feat-combat.ts).
  damageType?: string;
};

export type FeatChoices = Record<string, FeatPicks>;

const PICK_KINDS: PickKind[] = ["skills", "languages", "tools", "weapons", "armor"];
const SINGULAR: Record<PickKind, string> = { skills: "skill", languages: "language", tools: "tool", weapons: "weapon", armor: "armor" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 || word === "armor" ? "" : "s"}`;
const named = (list: string[] | undefined) => (list ?? []).filter((entry) => entry && entry.trim());
const dedicated = (spec: FeatGrantSpec, kind: PickKind) => (kind === "armor" ? 0 : spec[kind]);

// How many of a feat's shared picks ("three skills or tools") are made:
// every pick of those kinds beyond the kind's own count.
export function anyPicksMade(spec: FeatGrantSpec, picks: FeatPicks | undefined, except?: PickKind): number {
  return spec.anyKinds
    .filter((kind) => kind !== except)
    .reduce((sum, kind) => sum + Math.max(0, named(picks?.[kind]).length - dedicated(spec, kind)), 0);
}

// How many picks of a kind the feat allows: its own count, plus whatever
// of the shared count the other kinds have not used.
export function pickSlots(spec: FeatGrantSpec, picks: FeatPicks | undefined, kind: PickKind): number {
  const own = dedicated(spec, kind);
  return spec.anyKinds.includes(kind) ? own + Math.max(0, spec.any - anyPicksMade(spec, picks, kind)) : own;
}

// What the feat still waits for, as the sentence the gate shows, or null.
export function featPicksOwed(feat: string, spec: FeatGrantSpec, picks: FeatPicks | undefined): string | null {
  const has = (list: string[] | undefined) => named(list).length;
  const owed: string[] = [];
  if (spec.languages > has(picks?.languages)) {
    owed.push(plural(spec.languages - has(picks?.languages), "language"));
  }
  if (spec.skills > has(picks?.skills)) {
    owed.push(plural(spec.skills - has(picks?.skills), "skill"));
  }
  if (spec.expertise > has(picks?.expertise)) {
    owed.push(`expertise in ${plural(spec.expertise - has(picks?.expertise), "skill")}`);
  }
  if (spec.weapons > has(picks?.weapons)) {
    owed.push(plural(spec.weapons - has(picks?.weapons), "weapon"));
  }
  if (spec.tools > has(picks?.tools)) {
    owed.push(plural(spec.tools - has(picks?.tools), "tool"));
  }
  const shared = spec.any - anyPicksMade(spec, picks);
  if (shared > 0) {
    const kinds = spec.anyKinds.map((kind) => (shared === 1 ? SINGULAR[kind] : kind === "armor" ? "armor" : kind));
    owed.push(`${shared} ${kinds.join(" or ")}`);
  }
  if (spec.damageTypes.length && !(picks?.damageType ?? "").trim()) {
    owed.push("a damage type");
  }
  return owed.length ? `${feat}: pick ${owed.join(", ")}.` : null;
}

// Everything a feat still waits for, training and spells alike: the one
// sentence the builder's gate and the level-up dialog show.
export function featOwed(feat: string, spec: FeatGrantSpec, picks: FeatPicks | undefined): string | null {
  return featPicksOwed(feat, spec, picks) ?? featSpellsOwed(feat, spec.taught, picks);
}

export type FeatGrantInput = {
  proficiencies: Proficiencies;
  // The feats on the sheet, each with its text (empty when the catalog has
  // no row for it, which grants nothing).
  feats: Array<{ name: string; desc: string }>;
  choices: FeatChoices;
  // Strict: every pick a feat leaves open must be made, be one the feat
  // offers, and be new to the character. Otherwise what fits is applied
  // and the rest is left alone (a stored sheet, a companion the engine
  // drafts).
  strict: boolean;
};

export type FeatGrantVerdict = { proficiencies: Proficiencies; problems: string[] };

const WEAPON_NAMES = new Set(SRD_WEAPONS.map((weapon) => lower(weapon.name)));
const weaponName = (name: string) => SRD_WEAPONS.find((weapon) => lower(weapon.name) === lower(name))?.name ?? null;

// The sheet's training with every feat's grants in. Fixed grants always;
// picks as the sheet records them, held to the feat's text when strict.
export function applyFeatGrants(input: FeatGrantInput): FeatGrantVerdict {
  const problems: string[] = [];
  let languages = [...input.proficiencies.languages];
  let skills = [...input.proficiencies.skills];
  let expertise = [...(input.proficiencies.expertise ?? [])];
  let weapons = [...input.proficiencies.weapons];
  let tools = [...input.proficiencies.tools];
  let armor = [...input.proficiencies.armor];
  const has = (list: string[], entry: string) => list.some((held) => lower(held) === lower(entry));
  for (const feat of input.feats) {
    const spec = featGrantSpec(feat.desc);
    if (!featGrantsAnything(spec) && !spec.damageTypes.length) {
      continue;
    }
    const picks = input.choices[lower(feat.name)] ?? input.choices[feat.name] ?? {};
    for (const piece of spec.armor) {
      if (!has(armor, piece)) {
        armor.push(piece);
      }
    }
    for (const piece of spec.fixedWeapons) {
      if (!has(weapons, piece)) {
        weapons.push(piece);
      }
    }
    for (const piece of spec.fixedTools) {
      if (!has(tools, piece)) {
        tools.push(piece);
      }
    }
    // A skill or language the feat names outright; one already held is
    // simply held (Surgical Combatant's "if you are already proficient").
    for (const skill of spec.fixedSkills) {
      if (!has(skills, skill)) {
        skills.push(skill);
      }
    }
    for (const language of spec.fixedLanguages) {
      if (!has(languages, language)) {
        languages.push(language);
      }
    }
    if (input.strict) {
      const owed = featPicksOwed(feat.name, spec, picks);
      if (owed) {
        problems.push(owed);
      }
      const element = lower(picks.damageType ?? "");
      if (spec.damageTypes.length && element && !spec.damageTypes.includes(element)) {
        problems.push(`"${picks.damageType}" is not a damage type ${feat.name} offers; pick one of ${spec.damageTypes.join(", ")}.`);
      }
    }
    // Each kind takes its own count, then what is left of the shared one
    // ("three skills or tools"), in a fixed order so the budget is one.
    let shared = spec.any;
    const allowed = (kind: PickKind, list: string[]): string[] => {
      const own = dedicated(spec, kind);
      const extra = spec.anyKinds.includes(kind) ? Math.min(shared, Math.max(0, list.length - own)) : 0;
      if (spec.anyKinds.includes(kind)) {
        shared -= extra;
      }
      return list.slice(0, own + extra);
    };
    // Skills: real ones, not already held.
    const pickedSkills = allowed("skills", named(picks.skills).map(lower));
    for (const skill of pickedSkills) {
      if (!ALL_SKILLS.includes(skill as (typeof ALL_SKILLS)[number])) {
        if (input.strict) {
          problems.push(`"${skill}" is not a skill; ${feat.name}'s skill is picked from the skill list.`);
        }
        continue;
      }
      if (has(skills, skill)) {
        if (input.strict) {
          problems.push(`${feat.name} grants a new skill; this character is already proficient in ${skill}.`);
        }
        continue;
      }
      skills.push(skill);
    }
    // Languages: new ones, each once.
    const pickedLanguages = allowed("languages", named(picks.languages));
    for (const language of pickedLanguages) {
      if (has(languages, language)) {
        if (input.strict) {
          problems.push(`${feat.name}'s languages are new ones; this character already speaks ${language}.`);
        }
        continue;
      }
      languages.push(language.trim());
    }
    // Expertise: in a skill held (the feat's own counts), not already doubled.
    const pickedExpertise = named(picks.expertise).map(lower).slice(0, spec.expertise);
    for (const skill of pickedExpertise) {
      if (!has(skills, skill)) {
        if (input.strict) {
          problems.push(`${feat.name}'s expertise doubles a skill the character has; ${skill} is not among them.`);
        }
        continue;
      }
      if (has(expertise, skill)) {
        if (input.strict) {
          problems.push(`This character already has expertise in ${skill}; ${feat.name}'s goes on another skill.`);
        }
        continue;
      }
      expertise.push(skill);
    }
    // Tools: from what the feat offers, not already held.
    const pickedTools = allowed("tools", named(picks.tools).map(lower));
    for (const tool of pickedTools) {
      if (spec.toolsFrom.length && !spec.toolsFrom.includes(tool)) {
        if (input.strict) {
          problems.push(`"${tool}" is not a tool ${feat.name} offers.`);
        }
        continue;
      }
      if (has(tools, tool)) {
        if (input.strict) {
          problems.push(`${feat.name} grants a new tool; this character already has ${tool}.`);
        }
        continue;
      }
      tools.push(tool);
    }
    // Weapons: from the weapon table (or the part of it the feat names),
    // not already trained with by name.
    const pickedWeapons = allowed("weapons", named(picks.weapons));
    for (const weapon of pickedWeapons) {
      const name = weaponName(weapon);
      if (!name || !WEAPON_NAMES.has(lower(name))) {
        if (input.strict) {
          problems.push(`"${weapon}" is not a weapon on the table; ${feat.name}'s weapons are picked from it.`);
        }
        continue;
      }
      if (spec.weaponsFrom.length && !spec.weaponsFrom.some((offered) => lower(offered) === lower(name))) {
        if (input.strict) {
          problems.push(`${name} is not a weapon ${feat.name} offers.`);
        }
        continue;
      }
      if (has(weapons, name)) {
        continue;
      }
      weapons.push(name);
    }
    // Armor: what the feat offers (shields), not already worn.
    const pickedArmor = allowed("armor", named(picks.armor).map(lower));
    for (const piece of pickedArmor) {
      if (!spec.armorFrom.includes(piece)) {
        if (input.strict) {
          problems.push(`"${piece}" is not armor ${feat.name} offers.`);
        }
        continue;
      }
      if (has(armor, piece)) {
        if (input.strict) {
          problems.push(`${feat.name} grants new armor training; this character already has ${piece}.`);
        }
        continue;
      }
      armor.push(piece);
    }
  }
  languages = [...new Set(languages)];
  skills = [...new Set(skills)];
  expertise = [...new Set(expertise)];
  weapons = [...new Set(weapons)];
  tools = [...new Set(tools)];
  armor = [...new Set(armor)];
  return {
    problems,
    proficiencies: { ...input.proficiencies, languages, skills, expertise, weapons, tools, armor },
  };
}

// The training without the picks these feats made: what an edit starts
// from, so a Linguist's languages re-picked in the edit replace the old
// ones rather than pile on them. Fixed grants (armor) stay: they are the
// feat's whether or not it is re-picked, and the regrant adds them again.
export function withoutFeatPicks(proficiencies: Proficiencies, choices: FeatChoices | undefined): Proficiencies {
  if (!choices) {
    return proficiencies;
  }
  const picked = Object.values(choices);
  const drop = (kind: PickKind | "expertise") => new Set(picked.flatMap((picks) => (picks[kind] ?? []).map(lower)));
  const languages = drop("languages");
  const skills = drop("skills");
  const expertise = drop("expertise");
  const weapons = drop("weapons");
  const tools = drop("tools");
  const armor = drop("armor");
  return {
    ...proficiencies,
    languages: proficiencies.languages.filter((entry) => !languages.has(lower(entry))),
    skills: proficiencies.skills.filter((entry) => !skills.has(lower(entry))),
    expertise: (proficiencies.expertise ?? []).filter((entry) => !expertise.has(lower(entry)) && !skills.has(lower(entry))),
    weapons: proficiencies.weapons.filter((entry) => !weapons.has(lower(entry))),
    tools: proficiencies.tools.filter((entry) => !tools.has(lower(entry))),
    armor: proficiencies.armor.filter((entry) => !armor.has(lower(entry))),
  };
}

export { PICK_KINDS };
