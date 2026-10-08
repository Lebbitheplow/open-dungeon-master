// What a feat's text grants beyond its ability point, read from the words
// alone so a content pack's feats count as much as ODM's (issue #125), in
// every wording the packs use (issue #147): ODM's and the 2014 rows
// ("you learn three languages", "proficiency with heavy armor"), the 2024
// rows ("any combination of three skills or tools"), Level Up's ("Learn the
// heavy armor proficiency", "Select three languages", "Select and learn
// any four weapon proficiencies", "proficiency with thieves' tools, the
// poisoner's kit, or a rare weapon") and Tome of Heroes' ("You gain
// proficiency in the Stealth and Survival skills", "You learn to speak,
// read, and write Sylvan"). Any other wording grants nothing here and
// stays the table's. Pure; src/lib/srd/feat-grants.ts applies the result.
import { ALL_SKILLS, STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { featSpellSpec, type FeatSpellSpec } from "@/lib/srd/feat-spells";
import { ARTISANS_TOOLS, GAMING_SETS, MUSICAL_INSTRUMENTS } from "@/lib/srd/tool-choices";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

export type PickKind = "languages" | "skills" | "tools" | "weapons" | "armor";

// What a feat's text grants: how many of each kind are the player's to
// name, and what it hands over outright.
export type FeatGrantSpec = {
  languages: number;
  skills: number;
  expertise: number;
  weapons: number;
  tools: number;
  // What a tool pick may be: artisan's tools, instruments, gaming sets, the
  // tools a choice names, or every tool when the text says only "tool".
  toolsFrom: string[];
  // What a weapon pick may be, by name; empty for the whole table.
  weaponsFrom: string[];
  // Armor a choice offers (Heraldic Training's "one martial weapon or
  // shields"); empty when the feat offers none as a pick.
  armorFrom: string[];
  // Picks in any combination of kinds (Skilled's "three skills or tools"):
  // how many, and of which kinds. The picks are stored under their own
  // kind; the count is shared.
  any: number;
  anyKinds: PickKind[];
  armor: string[];
  fixedWeapons: string[];
  fixedTools: string[];
  fixedSkills: string[];
  fixedLanguages: string[];
  // The spells the feat teaches, read by src/lib/srd/feat-spells.ts.
  taught: FeatSpellSpec;
  // The damage types the feat lets the player choose one of (Elemental
  // Adept's "acid, cold, fire, lightning or thunder"); empty for none.
  damageTypes: string[];
};

const EMPTY: FeatGrantSpec = {
  languages: 0, skills: 0, expertise: 0, weapons: 0, tools: 0, any: 0,
  toolsFrom: [], weaponsFrom: [], armorFrom: [], anyKinds: [],
  armor: [], fixedWeapons: [], fixedTools: [], fixedSkills: [], fixedLanguages: [],
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
// A pack's name for a tool the table knows by another.
const TOOL_ALIASES: Record<string, string> = { "navigator's kit": "navigator's tools", "thieves' kit": "thieves' tools" };
const toolNamed = (words: string): string | null => {
  const name = TOOL_ALIASES[words] ?? words;
  return KNOWN_TOOLS.includes(name) ? name : null;
};

const KINDS: Record<string, PickKind> = {
  skill: "skills", skills: "skills", language: "languages", languages: "languages", tool: "tools", tools: "tools",
};
const SKILL_WORDS = ALL_SKILLS.map((id) => ({ id, pattern: new RegExp(`\\b${id.replace(/_/g, " ")}\\b`) }));
const skillsIn = (clause: string) => SKILL_WORDS.filter((skill) => skill.pattern.test(clause)).map((skill) => skill.id);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unique = <T,>(list: T[]) => [...new Set(list)];

export const lowerText = (value: string) => value.trim().toLowerCase().replace(/[‘’]/g, "'");
// The text as the patterns read it: lower case, bracketed asides and
// markdown out, one space between words.
const normalize = (desc: string) =>
  lowerText(desc ?? "").replace(/\([^)]*\)/g, " ").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();

const languageName = (words: string) => {
  const wanted = words.trim().toLowerCase();
  return (
    STANDARD_LANGUAGES.find((entry) => entry.toLowerCase() === wanted) ??
    wanted.replace(/(^|\s|')([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`)
  );
};

// Weapon names for "a simple ranged weapon", "one martial weapon", "a weapon".
function weaponsNamed(words: string): string[] | null {
  const match = /^(?:(simple|martial) )?(?:(ranged|melee) )?weapons?(?: of your choice)?$/.exec(words);
  if (!match) {
    return null;
  }
  return SRD_WEAPONS.filter(
    (weapon) =>
      (weapon.category === "simple" || weapon.category === "martial") &&
      (!match[1] || weapon.category === match[1]) &&
      (!match[2] || weapon.kind === match[2]),
  ).map((weapon) => weapon.name);
}

// Whether a feat's text grants anything this module applies.
export function featGrantsAnything(spec: FeatGrantSpec): boolean {
  return (
    spec.languages + spec.skills + spec.expertise + spec.weapons + spec.tools + spec.any > 0 ||
    spec.armor.length + spec.fixedWeapons.length + spec.fixedTools.length + spec.fixedSkills.length + spec.fixedLanguages.length > 0
  );
}

// The grants in a feat's text.
export function featGrantSpec(desc: string): FeatGrantSpec {
  let text = normalize(desc);
  if (!text) {
    return EMPTY;
  }
  const spec: FeatGrantSpec = {
    ...EMPTY, toolsFrom: [], weaponsFrom: [], armorFrom: [], anyKinds: [], armor: [], fixedWeapons: [], fixedTools: [],
    fixedSkills: [], fixedLanguages: [], taught: featSpellSpec(text), damageTypes: [],
  };
  // A clause read as a count is taken out of the text, so the fixed-grant
  // patterns below never read "proficiency with thieves' tools, the
  // poisoner's kit, or a rare weapon" as thieves' tools outright.
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(text);
    if (match) {
      text = text.replace(match[0], " ");
    }
    return match;
  };

  const elements = /\bchoose ((?:acid|cold|fire|lightning|thunder)(?:, (?:acid|cold|fire|lightning|thunder))*,? or (?:acid|cold|fire|lightning|thunder))\b/.exec(text);
  if (elements) {
    spec.damageTypes = elements[1].split(/,|\bor\b/).map((entry) => entry.trim()).filter(Boolean);
  }

  // "any combination of three skills or tools", "three skills, languages,
  // or tool proficiencies in any combination": one count, several kinds.
  const any = take(/\b(one|two|three|four) (skills?|languages?|tools?)((?:, (?:skills?|languages?|tools?))*),? or (skills?|languages?|tools?)(?: proficiencies)?\b/);
  if (any) {
    spec.any = count(any[1]);
    spec.anyKinds = unique([any[2], ...any[3].split(",").map((word) => word.trim()).filter(Boolean), any[4]].map((word) => KINDS[word]));
  }

  const languages = take(/\blearn (one|two|three|four|\d) (?:additional |new )?languages?\b|\b(one|two|three) languages? of your choice\b|\bselect (one|two|three|four) languages\b/);
  if (languages) {
    spec.languages = count(languages[1] ?? languages[2] ?? languages[3]);
  }
  const skills = take(/\bproficien(?:cy|t) (?:in|with) (?:any combination of )?(one|two|three|four) skills?\b/);
  if (skills) {
    spec.skills = count(skills[1]);
  }
  if (/\bexpertise (?:in|with) (?:one|a|that) skill\b/.test(text)) {
    spec.expertise = 1;
  }
  const weapons =
    take(/\bproficiency with (one|two|three|four) (?:simple or martial )?weapons? of your choice\b/) ??
    take(/\bselect and learn any (one|two|three|four) weapon proficiencies\b/);
  if (weapons) {
    spec.weapons = count(weapons[1]);
  }
  const toolPick = take(/\bproficiency with (one|two) (?:type of |set of |kind of )?(artisan's tools|musical instruments?|gaming sets?|tools?)(?: of your choice)?\b/);
  if (toolPick) {
    spec.tools = count(toolPick[1]);
    spec.toolsFrom =
      /artisan/.test(toolPick[2]) ? [...ARTISANS_TOOLS]
      : /instrument/.test(toolPick[2]) ? [...MUSICAL_INSTRUMENTS]
      : /gaming/.test(toolPick[2]) ? [...GAMING_SETS]
      : [...KNOWN_TOOLS];
  }

  // "proficiency with thieves' tools, the poisoner's kit, or a rare weapon
  // with the stealthy property": one pick among what the table knows of
  // the list. An alternative the table has no row for (a rare weapon, a
  // maneuver) is not offered.
  for (const choice of [...text.matchAll(/\bproficien(?:cy|t) (?:with|in) (?:your choice of )?([^.;]*?\bor\b[^.;]*)/g)]) {
    const alternatives = choice[1].split(/,|\bor\b/).map((entry) => entry.trim().replace(/^(?:a|an|one|the|any) /, "")).filter(Boolean);
    const tools = alternatives.map(toolNamed).filter((tool): tool is string => tool !== null);
    const weaponLists = alternatives.map(weaponsNamed).filter((list): list is string[] => list !== null);
    const armor = alternatives.filter((entry) => /^(?:shields?|(?:light|medium|heavy) armor)$/.test(entry)).map((entry) => entry.replace(/^shields?$/, "shields").replace(/ armor$/, ""));
    if (alternatives.length < 2 || tools.length + weaponLists.length + armor.length === 0) {
      continue;
    }
    text = text.replace(choice[0], " ");
    if (weaponLists.length + armor.length === 0) {
      spec.tools += 1;
      spec.toolsFrom = unique([...spec.toolsFrom, ...tools]);
      continue;
    }
    spec.any += 1;
    spec.anyKinds = unique([...spec.anyKinds, ...(tools.length ? ["tools" as const] : []), ...(weaponLists.length ? ["weapons" as const] : []), ...(armor.length ? ["armor" as const] : [])]);
    spec.toolsFrom = unique([...spec.toolsFrom, ...tools]);
    spec.weaponsFrom = unique([...spec.weaponsFrom, ...weaponLists.flat()]);
    spec.armorFrom = unique([...spec.armorFrom, ...armor]);
  }

  // Fixed grants: armor, weapons, tools, skills and languages named outright.
  const armorClause = /\bproficiency with (light|medium|heavy) armor\b/.test(text) ? [...text.matchAll(/\b(light|medium|heavy) armor\b/g)].map((hit) => hit[1]) : [];
  for (const learned of text.matchAll(/\blearn the (light|medium|heavy) armor (and shields? )?proficienc(?:y|ies)\b/g)) {
    armorClause.push(learned[1]);
    if (learned[2]) {
      armorClause.push("shields");
    }
  }
  if (/\b(?:armor and shields|proficiency with shields)\b/.test(text)) {
    armorClause.push("shields");
  }
  spec.armor = unique(armorClause);
  if (/\bproficien(?:cy|t) with improvised weapons\b|\blearn the improvised weapons? proficiency\b/.test(text)) {
    spec.fixedWeapons.push("improvised weapons");
  }
  if (/\bproficien(?:cy|t) with firearms\b/.test(text)) {
    spec.fixedWeapons.push("firearms");
  }
  for (const tool of KNOWN_TOOLS) {
    if (new RegExp(`\\bproficien(?:cy|t) with (?:the )?${escape(tool)}\\b`).test(text)) {
      spec.fixedTools.push(tool);
    }
  }
  for (const clause of text.matchAll(/\bgain proficiency in (?:the )?([^.;]+)/g)) {
    if (/\bof your choice\b|\bany combination\b|\b(?:one|two|three|four) skills?\b/.test(clause[1])) {
      continue;
    }
    spec.fixedSkills = unique([...spec.fixedSkills, ...skillsIn(clause[1])]);
  }
  for (const spoken of text.matchAll(/\blearn to speak, read, and write ([a-z' ]+?)[.,;]|\byou learn ([a-z' ]+?), the language of\b/g)) {
    spec.fixedLanguages = unique([...spec.fixedLanguages, languageName(spoken[1] ?? spoken[2])]);
  }
  return spec;
}
