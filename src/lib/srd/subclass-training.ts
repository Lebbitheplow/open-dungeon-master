// What a subclass trains its character in (issue 251).
//
// A Life Domain cleric's sheet listed "Bonus Proficiency (heavy armor)" under
// its features, and the training the engines read (proficiencies.armor) had
// no heavy armor: judgeProficiencies wrote the class's, the race's and a
// second class's training and nothing of the subclass's. The chain mail the
// cleric's own kit offers then counted as untrained armor, and the cast
// guard refused every spell.
//
// The grants come from two places:
//   - a table for the subclasses this build carries (SRD 5.1's two and the
//     authored ones in subclasses.json), keyed by the feature that grants
//     them, written from the published rules (the authored feature text
//     is a one-line summary, kept in step with this table);
//   - for a content pack's archetype or a workshop subclass, the text of a
//     feature named for its proficiencies, read the way a feat's is
//     (src/lib/srd/feat-grant-text.ts).
//
// Each grant is shaped as a feat's (FeatGrantSpec), so the same machinery
// applies it (applyFeatGrants) and the same pickers ask for its choices
// (FeatChoicesFields): the picks are stored in featChoices under the
// feature's name. Saving throws are the one kind a feat's spec has no
// place for, and are applied here. Pure.
import type { Ability, Proficiencies } from "@/lib/schemas/sheet";
import { classFeaturesFor, subclassFeatureDescription } from "@/lib/srd/features";
import { applyFeatGrants, type FeatChoices, type FeatGrantVerdict } from "@/lib/srd/feat-grants";
import { featGrantSpec, featGrantsAnything, type FeatGrantSpec } from "@/lib/srd/feat-grant-text";
import { featSpellSpec } from "@/lib/srd/feat-spells";
import { ARTISANS_TOOLS, GAMING_SETS } from "@/lib/srd/tool-choices";
import { ALL_SKILLS, STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { KNOWN_TOOLS } from "@/lib/srd/feat-grant-text";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import { textKey } from "@/lib/language/text-logic";
import { featChoice, withFeatChoice } from "@/lib/schemas/sheet";

export type SaveGrant = {
  // The saving throw the feature grants, and what it grants instead when
  // the character already has that one (Iron Mind's Intelligence or
  // Charisma). The better score of the fallbacks is taken: the level-up
  // has no picker for a save, and either is legal.
  save: Ability;
  otherwise: Ability[];
};

export type SubclassGrant = {
  // The feature's name, as the sheet lists it and featChoices keys it.
  name: string;
  classId: string;
  subclass: string;
  // The class level the feature arrives at.
  level: number;
  spec: FeatGrantSpec;
  saves?: SaveGrant;
  skillOtherwise?: { skill: string; from: string[] };
  languageOtherwise?: string;
};

type TableEntry = {
  armor?: string[];
  weapons?: string[];
  tools?: string[];
  skills?: string[];
  languages?: string[];
  expertise?: string[];
  pickSkills?: number;
  skillsFrom?: string[];
  pickedExpertise?: boolean;
  pickLanguages?: number;
  pickTools?: number;
  toolsFrom?: string[];
  pickWeapons?: number;
  weaponsFrom?: string[];
  // "one skill from the list, or a language": a count shared by kinds.
  any?: number;
  anyKinds?: Array<"skills" | "languages" | "tools">;
  saves?: SaveGrant;
  // A skill granted unless already held some other way, in which case one
  // of `from` is picked instead (Royal Envoy's Persuasion).
  skillOtherwise?: { skill: string; from: string[] };
  // A language granted unless already spoken, in which case one other
  // language is picked instead (Draconic Disciple's Draconic).
  languageOtherwise?: string;
};

const BLANK: FeatGrantSpec = {
  languages: 0, skills: 0, expertise: 0, weapons: 0, tools: 0, any: 0,
  toolsFrom: [], weaponsFrom: [], armorFrom: [], anyKinds: [],
  armor: [], fixedWeapons: [], fixedTools: [], fixedSkills: [], fixedLanguages: [],
  skillsFrom: [], fixedExpertise: [], pickedExpertise: false,
  taught: featSpellSpec(""),
  damageTypes: [],
};

function specOf(entry: TableEntry): FeatGrantSpec {
  return {
    ...BLANK,
    armor: entry.armor ?? [],
    fixedWeapons: entry.weapons ?? [],
    fixedTools: entry.tools ?? [],
    fixedSkills: entry.skills ?? [],
    fixedLanguages: entry.languages ?? [],
    fixedExpertise: entry.expertise ?? [],
    skills: entry.pickSkills ?? 0,
    skillsFrom: entry.skillsFrom ?? [],
    pickedExpertise: entry.pickedExpertise ?? false,
    languages: entry.pickLanguages ?? 0,
    tools: entry.pickTools ?? 0,
    toolsFrom: entry.toolsFrom ?? [],
    weapons: entry.pickWeapons ?? 0,
    weaponsFrom: entry.weaponsFrom ?? [],
    any: entry.any ?? 0,
    anyKinds: entry.anyKinds ?? [],
  };
}

// A kensei weapon: a simple or martial weapon without the heavy or special
// property, or the longbow (Xanathar's, Way of the Kensei).
const KENSEI_WEAPONS = SRD_WEAPONS.filter(
  (weapon) =>
    (weapon.category === "simple" || weapon.category === "martial") &&
    !(weapon.properties ?? []).some((property) => /heavy|special/i.test(property)),
)
  .map((weapon) => weapon.name)
  .concat(SRD_WEAPONS.some((weapon) => weapon.name === "Longbow") ? ["Longbow"] : []);
// A Bladesinger's one-handed melee weapon: any melee weapon without the
// two-handed property.
const ONE_HANDED_MELEE = SRD_WEAPONS.filter(
  (weapon) =>
    weapon.kind === "melee" &&
    (weapon.category === "simple" || weapon.category === "martial") &&
    !(weapon.properties ?? []).some((property) => /two-handed/i.test(property)),
).map((weapon) => weapon.name);

// By "class|subclass|feature", lower case. Written from the published rules
// where the authored summary is vaguer than they are.
const TABLE: Record<string, TableEntry> = {
  // SRD 5.1.
  "cleric|life domain|bonus proficiency (heavy armor)": { armor: ["heavy"] },
  "bard|college of lore|bonus proficiencies (lore)": { pickSkills: 3 },
  // The authored subclasses (src/lib/srd/subclasses.json).
  "bard|college of valor|bonus proficiencies (valor)": { armor: ["medium", "shields"], weapons: ["martial"] },
  "bard|college of swords|bonus proficiencies (swords)": { armor: ["medium"], weapons: ["Scimitar"] },
  "cleric|knowledge domain|blessings of knowledge": {
    pickLanguages: 2,
    pickSkills: 2,
    skillsFrom: ["arcana", "history", "nature", "religion"],
    pickedExpertise: true,
  },
  "cleric|nature domain|acolyte of nature": { pickSkills: 1, skillsFrom: ["animal_handling", "nature", "survival"] },
  "cleric|nature domain|bonus proficiency (heavy armor)": { armor: ["heavy"] },
  "cleric|tempest domain|bonus proficiencies (tempest)": { armor: ["heavy"], weapons: ["martial"] },
  "cleric|war domain|bonus proficiencies (war)": { armor: ["heavy"], weapons: ["martial"] },
  "cleric|death domain|bonus proficiency (martial weapons)": { weapons: ["martial"] },
  "cleric|forge domain|bonus proficiencies (forge)": { armor: ["heavy"], tools: ["smith's tools"] },
  "cleric|order domain|bonus proficiencies (order)": { armor: ["heavy"], pickSkills: 1, skillsFrom: ["intimidation", "persuasion"] },
  "cleric|peace domain|implement of peace": { pickSkills: 1, skillsFrom: ["insight", "performance", "persuasion"] },
  "cleric|twilight domain|bonus proficiencies (twilight)": { armor: ["heavy"], weapons: ["martial"] },
  "cleric|arcana domain|arcane initiate": { skills: ["arcana"] },
  "fighter|battle master|student of war": { pickTools: 1, toolsFrom: [...ARTISANS_TOOLS] },
  "fighter|arcane archer|arcane archer lore": { pickSkills: 1, skillsFrom: ["arcana", "nature"] },
  "fighter|cavalier|bonus proficiency (cavalier)": {
    any: 1,
    anyKinds: ["skills", "languages"],
    skillsFrom: ["animal_handling", "history", "insight", "performance", "persuasion"],
  },
  "fighter|samurai|bonus proficiency (samurai)": {
    any: 1,
    anyKinds: ["skills", "languages"],
    skillsFrom: ["history", "insight", "performance", "persuasion"],
  },
  "fighter|samurai|elegant courtier": { saves: { save: "wis", otherwise: ["int", "cha"] } },
  "fighter|rune knight|bonus proficiencies (rune knight)": { tools: ["smith's tools"], languages: ["Giant"] },
  // Persuasion, its proficiency bonus doubled; one already proficient picks
  // Animal Handling, Insight, Intimidation or Performance instead
  // (skillOtherwise, read with the sheet's training in applySubclassTraining).
  "fighter|banneret|royal envoy": {
    skills: ["persuasion"],
    expertise: ["persuasion"],
    skillOtherwise: { skill: "persuasion", from: ["animal_handling", "insight", "intimidation", "performance"] },
  },
  "barbarian|path of the giant|giant's power": { languages: ["Giant"] },
  "druid|circle of the shepherd|speech of the woods": { languages: ["Sylvan"] },
  "sorcerer|storm sorcery|wind speaker": { languages: ["Primordial"] },
  "monk|way of the ascendant dragon|draconic disciple": { languages: ["Draconic"], languageOtherwise: "Draconic" },
  "ranger|drakewarden|draconic gift": { languages: ["Draconic"], languageOtherwise: "Draconic" },
  "monk|way of the drunken master|bonus proficiencies (drunken master)": { skills: ["performance"], tools: ["brewer's supplies"] },
  "monk|way of mercy|implements of mercy": { skills: ["insight", "medicine"], tools: ["herbalism kit"] },
  "monk|way of the kensei|path of the kensei": {
    pickWeapons: 2,
    weaponsFrom: KENSEI_WEAPONS,
    pickTools: 1,
    toolsFrom: ["calligrapher's supplies", "painter's supplies"],
  },
  // One more kensei weapon at 6th, 11th and 17th level, with the feature
  // the monk gains at that level.
  "monk|way of the kensei|one with the blade": { pickWeapons: 1, weaponsFrom: KENSEI_WEAPONS },
  "monk|way of the kensei|sharpen the blade": { pickWeapons: 1, weaponsFrom: KENSEI_WEAPONS },
  "monk|way of the kensei|unerring accuracy": { pickWeapons: 1, weaponsFrom: KENSEI_WEAPONS },
  "ranger|gloom stalker|iron mind": { saves: { save: "wis", otherwise: ["int", "cha"] } },
  "ranger|fey wanderer|otherworldly glamour": { pickSkills: 1, skillsFrom: ["deception", "performance", "persuasion"] },
  "rogue|assassin|bonus proficiencies (assassin)": { tools: ["disguise kit", "poisoner's kit"] },
  "rogue|mastermind|master of intrigue": {
    tools: ["disguise kit", "forgery kit"],
    pickTools: 1,
    toolsFrom: [...GAMING_SETS],
    pickLanguages: 2,
  },
  "rogue|scout|survivalist": { skills: ["nature", "survival"], expertise: ["nature", "survival"] },
  "warlock|the hexblade|hex warrior": { armor: ["medium", "shields"], weapons: ["martial"] },
  "wizard|bladesinging|training in war and song": {
    armor: ["light"],
    skills: ["performance"],
    pickWeapons: 1,
    weaponsFrom: ONE_HANDED_MELEE,
  },
  "artificer|alchemist|tool proficiency (alchemist)": { tools: ["alchemist's supplies"] },
  // Tasha's, Armorer, Tools of the Trade: heavy armor as well as the tools.
  "artificer|armorer|tool proficiency (armorer)": { armor: ["heavy"], tools: ["smith's tools"] },
  "artificer|artillerist|tool proficiency (artillerist)": { tools: ["woodcarver's tools"] },
  "artificer|battle smith|tool proficiency (battle smith)": { tools: ["smith's tools"] },
  "artificer|battle smith|battle ready": { weapons: ["martial"] },
};

const key = (classId: string, subclass: string, feature: string) =>
  `${classId}|${subclass}|${feature}`.trim().toLowerCase();

// Every entry the table carries, for the test that holds each to a real
// feature of a real subclass.
export function trainingTableKeys(): string[] {
  return Object.keys(TABLE);
}

// A feature whose text, read alone, trains the character for good: named for
// its proficiencies or training, and not a lasting-for-a-while one (the
// Knowledge Domain's ten minutes, the Phantom's "after each rest").
const NAMED_FOR_TRAINING = /\bproficienc(?:y|ies)\b|\btraining\b/i;
const PASSING = /\bfor (?:\d+|one|ten) (?:minutes?|hours?)\b|\buntil\b|\bafter (?:each|a) (?:short |long )?rest\b|\bwhile\b/i;

// The pack's and the workshop's terse wordings the feat reader does not
// read: "Proficiency with martial weapons and heavy armor.", "Heavy armor,
// plus ...". Armor, weapon categories and named tools only; anything
// chosen is left to the feat reader's patterns, which it does read.
function terseTraining(text: string, spec: FeatGrantSpec): FeatGrantSpec {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  const armor = new Set(spec.armor);
  for (const piece of ["light", "medium", "heavy"] as const) {
    if (new RegExp(`\\b${piece} armor\\b`).test(lower) && !new RegExp(`\\b(?:or|either) ${piece} armor\\b`).test(lower)) {
      armor.add(piece);
    }
  }
  if (/\bshields?\b/.test(lower) && /proficien|training|armor/.test(lower)) {
    armor.add("shields");
  }
  const weapons = new Set(spec.fixedWeapons);
  for (const category of ["simple", "martial"] as const) {
    if (new RegExp(`\\b${category} weapons\\b`).test(lower) && !new RegExp(`\\bone ${category} weapon\\b`).test(lower)) {
      weapons.add(category);
    }
  }
  // Tools named outright ("thieves' tools and mason's tools"); one offered
  // as an alternative ("either cartographer's tools or navigator's tools")
  // is a pick the feat reader already counted.
  const tools = new Set(spec.fixedTools);
  for (const tool of KNOWN_TOOLS) {
    const at = lower.indexOf(tool);
    if (at < 0 || spec.toolsFrom.includes(tool)) {
      continue;
    }
    const around = lower.slice(Math.max(0, at - 24), at + tool.length + 24);
    if (!/\bor\b|\beither\b|\bchoice\b/.test(around)) {
      tools.add(tool);
    }
  }
  return { ...spec, armor: [...armor], fixedWeapons: [...weapons], fixedTools: [...tools] };
}

// The grant in a pack or workshop feature's text, or null when it trains in
// nothing the sheet keeps.
export function trainingFromText(name: string, text: string): FeatGrantSpec | null {
  if (!NAMED_FOR_TRAINING.test(name) || PASSING.test(text)) {
    return null;
  }
  const spec = terseTraining(text, featGrantSpec(text));
  return featGrantsAnything(spec) ? spec : null;
}

export type ClassEntryLike = { id: string; level: number; subclass?: string | null };

// The training every subclass on the sheet has granted by its class's
// level, in class order, each once.
export function subclassGrants(classes: ClassEntryLike[], extras?: SubclassExtras): SubclassGrant[] {
  const grants: SubclassGrant[] = [];
  const seen = new Set<string>();
  for (const entry of classes) {
    const subclass = (entry.subclass ?? "").trim();
    if (!subclass || !entry.id) {
      continue;
    }
    // Only the subclass's own features: the class's table has none of these.
    const base = new Set(classFeaturesFor(entry.id, "", entry.level).map((feature) => textKey(feature.name)));
    for (const feature of classFeaturesFor(entry.id, subclass, entry.level, extras)) {
      const name = feature.name.trim();
      if (base.has(textKey(name)) || seen.has(key(entry.id, subclass, name))) {
        continue;
      }
      seen.add(key(entry.id, subclass, name));
      const authored = TABLE[key(entry.id, subclass, name)];
      const level = feature.level ?? entry.level;
      if (authored) {
        grants.push({
          name,
          classId: entry.id,
          subclass,
          level,
          spec: specOf(authored),
          ...(authored.saves ? { saves: authored.saves } : {}),
          ...(authored.skillOtherwise ? { skillOtherwise: authored.skillOtherwise } : {}),
          ...(authored.languageOtherwise ? { languageOtherwise: authored.languageOtherwise } : {}),
        });
        continue;
      }
      const text = subclassFeatureDescription(entry.id, subclass, name, extras) ?? "";
      const spec = text ? trainingFromText(name, text) : null;
      if (spec) {
        grants.push({ name, classId: entry.id, subclass, level, spec });
      }
    }
  }
  return grants;
}

// The grants as they fall on a character already trained some other way
// (class, background, race, feats): a skill a grant would give again becomes
// a pick from its list instead (Royal Envoy's Persuasion), and a language
// already spoken a pick of another (Draconic Disciple). Callers pass the
// training from before the subclass's, so a grant never finds its own; the
// grant it returns has settled, so a second pass changes nothing.
export function grantsForHeldTraining(
  grants: SubclassGrant[],
  held: { skills: string[]; languages?: string[] },
): SubclassGrant[] {
  const skills = new Set(held.skills.map(textKey));
  const languages = new Set((held.languages ?? []).map(textKey));
  return grants.map((grant) => {
    const { skillOtherwise: other, languageOtherwise: tongue, ...rest } = grant;
    let spec = grant.spec;
    if (other && skills.has(textKey(other.skill))) {
      spec = {
        ...spec,
        fixedSkills: spec.fixedSkills.filter((skill) => textKey(skill) !== textKey(other.skill)),
        skills: spec.skills + 1,
        skillsFrom: [...new Set([...spec.skillsFrom, ...other.from])],
      };
    }
    if (tongue && languages.has(textKey(tongue))) {
      spec = {
        ...spec,
        fixedLanguages: spec.fixedLanguages.filter((language) => textKey(language) !== textKey(tongue)),
        languages: spec.languages + 1,
      };
    }
    return spec === grant.spec ? grant : { ...rest, spec };
  });
}

const ABILITY_KEYS: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// The saving throws the grants give: the named one, or the better of the
// fallbacks when it is held already.
function withSaves(
  saves: Ability[],
  grants: SubclassGrant[],
  abilities: Partial<Record<Ability, number>> | undefined,
): Ability[] {
  const out = [...saves];
  for (const grant of grants) {
    if (!grant.saves) {
      continue;
    }
    if (!out.includes(grant.saves.save)) {
      out.push(grant.saves.save);
      continue;
    }
    const open = grant.saves.otherwise.filter((ability) => !out.includes(ability));
    if (open.length) {
      const best = [...open].sort((a, b) => (abilities?.[b] ?? 10) - (abilities?.[a] ?? 10))[0];
      out.push(best);
    }
  }
  return out.filter((ability) => ABILITY_KEYS.includes(ability));
}

// The sheet's training with every subclass grant in: the fixed ones always,
// the picks as featChoices records them under the feature's name, held to
// the grant when strict (a character made or edited here); a stored sheet
// or an engine's companion keeps what fits and leaves the rest owed.
export function applySubclassTraining(input: {
  proficiencies: Proficiencies;
  grants: SubclassGrant[];
  choices: FeatChoices;
  strict: boolean;
  // A file's picks may wait, as a feat's do (applyFeatGrants).
  picksMayWait?: boolean;
  abilities?: Partial<Record<Ability, number>>;
}): FeatGrantVerdict {
  if (!input.grants.length) {
    return { proficiencies: input.proficiencies, problems: [] };
  }
  const grants = grantsForHeldTraining(input.grants, input.proficiencies);
  const applied = applyFeatGrants({
    proficiencies: input.proficiencies,
    feats: grants.map((grant) => ({ name: grant.name, desc: "", spec: grant.spec })),
    choices: input.choices,
    strict: input.strict,
    picksMayWait: input.picksMayWait,
  });
  const saves = withSaves(applied.proficiencies.saves as Ability[], input.grants, input.abilities);
  return {
    problems: applied.problems,
    proficiencies: { ...applied.proficiencies, saves },
    ...(applied.owed ? { owed: applied.owed } : {}),
  };
}

// The armor and weapon training the subclasses give outright, for the checks
// that run before the full training is written (a feat's prerequisite: a
// Life Domain cleric qualifies for Heavy Armor Master).
export function subclassFixedTraining(grants: SubclassGrant[]): { armor: string[]; weapons: string[] } {
  return {
    armor: [...new Set(grants.flatMap((grant) => grant.spec.armor))],
    weapons: [...new Set(grants.flatMap((grant) => grant.spec.fixedWeapons))],
  };
}

// The picks a character the engine makes or levels (a companion) takes on
// its own: the first options of each list the character does not hold yet,
// so a Lore bard companion reaches level 3 with its three skills rather than
// being refused for want of a player to choose them. A pick the request
// already names is kept.
export function autoSubclassPicks(grants: SubclassGrant[], held: Proficiencies, choices: FeatChoices = {}): FeatChoices {
  let out: FeatChoices = { ...choices };
  const has = (list: string[], entry: string) => list.some((value) => textKey(value) === textKey(entry));
  const skills = [...held.skills];
  const languages = [...held.languages];
  const tools = [...held.tools];
  const weapons = [...held.weapons];
  for (const grant of grants) {
    const picks = { ...(featChoice(out, grant.name) ?? {}) };
    const fill = (kind: "skills" | "languages" | "tools" | "weapons", count: number, pool: readonly string[], own: string[]) => {
      const current = [...(picks[kind] ?? [])].filter(Boolean);
      for (const option of pool) {
        if (current.length >= count) {
          break;
        }
        if (!has(own, option) && !has(current, option)) {
          current.push(option);
        }
      }
      if (current.length) {
        picks[kind] = current;
        own.push(...current.filter((entry) => !has(own, entry)));
      }
    };
    const spec = grant.spec;
    fill("skills", spec.skills, spec.skillsFrom.length ? spec.skillsFrom : ALL_SKILLS, skills);
    fill("languages", spec.languages, STANDARD_LANGUAGES, languages);
    fill("tools", spec.tools, spec.toolsFrom.length ? spec.toolsFrom : KNOWN_TOOLS, tools);
    fill("weapons", spec.weapons, spec.weaponsFrom.length ? spec.weaponsFrom : SRD_WEAPONS.filter((weapon) => weapon.category === "simple").map((weapon) => weapon.name), weapons);
    // A shared count ("a skill or a language") goes to its first kind.
    const shared = spec.anyKinds[0];
    if (spec.any > 0 && shared) {
      const pools: Record<string, { pool: readonly string[]; own: string[] }> = {
        skills: { pool: spec.skillsFrom.length ? spec.skillsFrom : ALL_SKILLS, own: skills },
        languages: { pool: STANDARD_LANGUAGES, own: languages },
        tools: { pool: spec.toolsFrom.length ? spec.toolsFrom : KNOWN_TOOLS, own: tools },
      };
      const target = pools[shared];
      if (target) {
        fill(shared as "skills" | "languages" | "tools", spec[shared as "skills" | "languages" | "tools"] + spec.any, target.pool, target.own);
      }
    }
    if (Object.keys(picks).length) {
      out = withFeatChoice(out, grant.name, picks);
    }
  }
  return out;
}

// A stored sheet's training with what its subclasses grant added: the fixed
// grants, and the picks its featChoices already records. Only ever adds;
// null when nothing was missing. The boot resync repairs sheets made before
// the grants were applied with it (src/lib/db/core.ts), so a Life Domain
// cleric in play gains the heavy armor its feature names without being
// rebuilt or losing anything it holds.
export function repairedTraining(
  sheet: { proficiencies: Proficiencies; abilities?: Partial<Record<Ability, number>>; featChoices?: FeatChoices },
  classes: ClassEntryLike[],
  extras?: SubclassExtras,
): Proficiencies | null {
  const grants = subclassGrants(classes, extras);
  if (!grants.length) {
    return null;
  }
  const before = sheet.proficiencies;
  const after = applySubclassTraining({
    proficiencies: before,
    grants,
    choices: sheet.featChoices ?? {},
    strict: false,
    abilities: sheet.abilities,
  }).proficiencies;
  const grew = (["saves", "skills", "expertise", "languages", "tools", "armor", "weapons"] as const).some(
    (kind) => (after[kind] ?? []).length > (before[kind] ?? []).length,
  );
  return grew ? after : null;
}
