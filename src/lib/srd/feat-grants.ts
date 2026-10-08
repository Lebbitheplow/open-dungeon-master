// What a feat hands over beyond its ability point: languages, skills,
// expertise, armor, weapons and tools, read from the feat's own text so a
// content pack's feats count as much as ODM's (issue #125: Linguist's three
// languages, Heavily Armored's armor and Skill Expert's skill were words on
// the sheet and nothing more, while the DM held the character to "only
// their listed languages").
//
// A grant that leaves a choice (which three languages, which skill, which
// four weapons) is picked where the feat is picked and stored on the sheet
// as featChoices, keyed by the feat's name. The server applies the grants
// when the sheet is made, edited or levelled (src/lib/srd/sheet-legality.ts,
// src/lib/srd/level-up.ts); the builder applies them to its preview. Pure.
import type { Proficiencies } from "@/lib/schemas/sheet";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { featSpellSpec, featSpellsOwed, type CastingAbility, type FeatSpellSpec } from "@/lib/srd/feat-spells";
import { ARTISANS_TOOLS, GAMING_SETS, MUSICAL_INSTRUMENTS } from "@/lib/srd/tool-choices";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

export type FeatPicks = {
  languages?: string[];
  skills?: string[];
  expertise?: string[];
  weapons?: string[];
  tools?: string[];
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

// What a feat's text grants: how many of each kind are the player's to
// name, and what it hands over outright.
export type FeatGrantSpec = {
  languages: number;
  skills: number;
  expertise: number;
  weapons: number;
  tools: number;
  // What a tool pick may be: artisan's tools, instruments, gaming sets, or
  // every tool when the text says only "tool".
  toolsFrom: string[];
  armor: string[];
  fixedWeapons: string[];
  fixedTools: string[];
  // The spells the feat teaches, read by src/lib/srd/feat-spells.ts.
  taught: FeatSpellSpec;
  // The damage types the feat lets the player choose one of (Elemental
  // Adept's "acid, cold, fire, lightning or thunder"); empty for none.
  damageTypes: string[];
};

const EMPTY: FeatGrantSpec = {
  languages: 0, skills: 0, expertise: 0, weapons: 0, tools: 0, toolsFrom: [], armor: [], fixedWeapons: [], fixedTools: [],
  taught: featSpellSpec(""),
  damageTypes: [],
};

const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const count = (word: string | undefined) => (word ? (COUNTS[word.toLowerCase()] ?? Number(word) ?? 0) : 0);

const OTHER_TOOLS = [
  "thieves' tools", "disguise kit", "forgery kit", "herbalism kit", "navigator's tools", "poisoner's kit",
  "vehicles (land)", "vehicles (water)", "tinker's tools",
];
export const KNOWN_TOOLS = [...new Set([...ARTISANS_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS, ...OTHER_TOOLS])];

const lower = (value: string) => value.trim().toLowerCase().replace(/[‘’]/g, "'");

// Whether a feat's text grants anything this module applies.
export function featGrantsAnything(spec: FeatGrantSpec): boolean {
  return (
    spec.languages + spec.skills + spec.expertise + spec.weapons + spec.tools > 0 ||
    spec.armor.length + spec.fixedWeapons.length + spec.fixedTools.length > 0
  );
}

// The grants in a feat's text. The clauses ODM's feats and the 2014 packs
// use: "you learn three languages", "gain proficiency in one skill",
// "expertise in one skill", "proficiency with heavy armor", "medium armor
// and shields", "four weapons of your choice", "proficient with improvised
// weapons", "proficiency with cook's utensils", "one type of artisan's
// tools". Any other wording grants nothing here and stays the table's.
export function featGrantSpec(desc: string): FeatGrantSpec {
  const text = lower(desc ?? "");
  if (!text) {
    return EMPTY;
  }
  const spec: FeatGrantSpec = { ...EMPTY, toolsFrom: [], armor: [], fixedWeapons: [], fixedTools: [], taught: featSpellSpec(text), damageTypes: [] };
  const elements = /\bchoose ((?:acid|cold|fire|lightning|thunder)(?:, (?:acid|cold|fire|lightning|thunder))*,? or (?:acid|cold|fire|lightning|thunder))\b/.exec(text);
  if (elements) {
    spec.damageTypes = elements[1].split(/,|\bor\b/).map((entry) => entry.trim()).filter(Boolean);
  }
  const languages = /\blearn (one|two|three|four|\d) (?:additional |new )?languages?\b|\b(one|two|three) languages? of your choice\b/.exec(text);
  if (languages) {
    spec.languages = count(languages[1] ?? languages[2]);
  }
  const skills = /\bproficien(?:cy|t) (?:in|with) (?:any combination of )?(one|two|three|four) skills?\b/.exec(text);
  if (skills) {
    spec.skills = count(skills[1]);
  }
  if (/\bexpertise (?:in|with) (?:one|a|that) skill\b/.test(text)) {
    spec.expertise = 1;
  }
  for (const armor of /\bproficiency with (light|medium|heavy) armor\b/.exec(text) ? [...text.matchAll(/\b(light|medium|heavy) armor\b/g)].map((hit) => hit[1]) : []) {
    if (!spec.armor.includes(armor)) {
      spec.armor.push(armor);
    }
  }
  if (/\b(?:armor and shields|proficiency with shields)\b/.test(text)) {
    spec.armor.push("shields");
  }
  const weapons = /\bproficiency with (one|two|three|four) (?:simple or martial )?weapons? of your choice\b/.exec(text);
  if (weapons) {
    spec.weapons = count(weapons[1]);
  }
  if (/\bproficien(?:cy|t) with improvised weapons\b/.test(text)) {
    spec.fixedWeapons.push("improvised weapons");
  }
  if (/\bproficien(?:cy|t) with firearms\b/.test(text)) {
    spec.fixedWeapons.push("firearms");
  }
  const toolPick = /\bproficiency with (one|two) (?:type of |set of |kind of )?(artisan's tools|musical instruments?|gaming sets?|tools?)(?: of your choice)?\b/.exec(text);
  if (toolPick) {
    spec.tools = count(toolPick[1]);
    spec.toolsFrom =
      /artisan/.test(toolPick[2]) ? [...ARTISANS_TOOLS]
      : /instrument/.test(toolPick[2]) ? [...MUSICAL_INSTRUMENTS]
      : /gaming/.test(toolPick[2]) ? [...GAMING_SETS]
      : [...KNOWN_TOOLS];
  }
  for (const tool of KNOWN_TOOLS) {
    if (new RegExp(`\\bproficien(?:cy|t) with (?:the )?${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      spec.fixedTools.push(tool);
    }
  }
  return spec;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the feat still waits for, as the sentence the gate shows, or null.
export function featPicksOwed(feat: string, spec: FeatGrantSpec, picks: FeatPicks | undefined): string | null {
  const has = (list: string[] | undefined) => (list ?? []).filter((entry) => entry && entry.trim()).length;
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
    // Languages: new ones, each once.
    const pickedLanguages = (picks.languages ?? []).filter((entry) => entry.trim()).slice(0, spec.languages);
    for (const language of pickedLanguages) {
      if (has(languages, language)) {
        if (input.strict) {
          problems.push(`${feat.name}'s languages are new ones; this character already speaks ${language}.`);
        }
        continue;
      }
      languages.push(language.trim());
    }
    // Skills: real ones, not already held.
    const pickedSkills = (picks.skills ?? []).map(lower).filter(Boolean).slice(0, spec.skills);
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
    // Expertise: in a skill held (the feat's own counts), not already doubled.
    const pickedExpertise = (picks.expertise ?? []).map(lower).filter(Boolean).slice(0, spec.expertise);
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
    // Weapons: from the weapon table, not already trained with by name.
    const pickedWeapons = (picks.weapons ?? []).filter((entry) => entry.trim()).slice(0, spec.weapons);
    for (const weapon of pickedWeapons) {
      const name = weaponName(weapon);
      if (!name || !WEAPON_NAMES.has(lower(name))) {
        if (input.strict) {
          problems.push(`"${weapon}" is not a weapon on the table; ${feat.name}'s weapons are picked from it.`);
        }
        continue;
      }
      if (has(weapons, name)) {
        continue;
      }
      weapons.push(name);
    }
    // Tools: from what the feat offers, not already held.
    const pickedTools = (picks.tools ?? []).map(lower).filter(Boolean).slice(0, spec.tools);
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
  const drop = (kind: "languages" | "skills" | "expertise" | "weapons" | "tools") =>
    new Set(picked.flatMap((picks) => (picks[kind] ?? []).map(lower)));
  const languages = drop("languages");
  const skills = drop("skills");
  const expertise = drop("expertise");
  const weapons = drop("weapons");
  const tools = drop("tools");
  return {
    ...proficiencies,
    languages: proficiencies.languages.filter((entry) => !languages.has(lower(entry))),
    skills: proficiencies.skills.filter((entry) => !skills.has(lower(entry))),
    expertise: (proficiencies.expertise ?? []).filter((entry) => !expertise.has(lower(entry)) && !skills.has(lower(entry))),
    weapons: proficiencies.weapons.filter((entry) => !weapons.has(lower(entry))),
    tools: proficiencies.tools.filter((entry) => !tools.has(lower(entry))),
  };
}
