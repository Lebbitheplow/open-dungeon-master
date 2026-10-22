import type { Finding } from "@/lib/rulesets/validate";
import { classFeaturesFor, subclassLevelFor, subclassNamesFor } from "@/lib/srd/features";
import { featAbilityIncreaseFrom } from "@/lib/srd/feat-effects";
import { featGrantSpec } from "@/lib/srd/feat-grant-text";
import { unreadResistances } from "@/lib/workshop/species-traits";
import { backgroundMechanics, raceMechanics } from "@/lib/content/mechanics";

// What the workshop's checker says about a feat, a background, a species, a
// subclass or a hazard, measured against the SRD 5.1's own: two skills from
// every background, a species's +3, a subclass's feature levels, the
// trap-DC bands. Findings, not refusals: a DM may mean to break a norm, and
// the checker says what the table will feel when they do. Pure.

type Data = Record<string, unknown>;
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const rec = (value: unknown): Data => (value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function featFindings(name: string, data: Data): Finding[] {
  const out: Finding[] = [];
  const desc = String(data.desc ?? "").trim();
  if (data.runsAs) {
    out.push({ level: "note", text: `Runs at the table as ${String(data.runsAs)}: the server applies its rules under the name ${name || "this feat"}.` });
  } else if (!desc) {
    out.push({ level: "warn", text: "No text and nothing it runs as: the table reads a feat by its words, so this one grants nothing." });
  }
  // What the builder hands out from the words (src/lib/srd/feat-grant-text.ts),
  // so a homebrew feat's grants are seen before a player takes it.
  const grants = desc ? featGrantWords(desc) : [];
  if (grants.length) {
    out.push({ level: "note", text: `From its words the builder grants: ${grants.join("; ")}.` });
  } else if (desc && !data.runsAs) {
    out.push({
      level: "note",
      text: "Nothing in its words is a grant the builder hands out, so the DM runs it. Written as the books write them (\"Increase your Dexterity by 1\", \"You gain proficiency in the Stealth skill\", \"You learn two languages of your choice\"), the builder grants them; or pick a published feat it runs as.",
    });
  }
  if (/\b(?:increase|raise)s?\b[^.]*\bby 2\b/i.test(desc) && featAbilityIncreaseFrom(desc) === null) {
    out.push({ level: "warn", text: "Raises a score by 2: an SRD feat that raises a score raises it by 1 (a feat is chosen in place of the +2 of an Ability Score Improvement)." });
  }
  return out;
}

export function backgroundFindings(data: Data): Finding[] {
  const out: Finding[] = [];
  const parsed = backgroundMechanics(data);
  const grants = rec(data.grants);
  const skills = parsed.skills.length + (parsed.skillChoice?.count ?? 0);
  if (skills !== 2) {
    out.push({ level: "warn", text: `Grants ${skills} skill${skills === 1 ? "" : "s"}: every SRD background grants exactly two.` });
  }
  const extras = parsed.tools.length + parsed.languages + parsed.knownLanguages.length;
  if (extras !== 2) {
    out.push({ level: "note", text: `${extras} tools and languages between them: an SRD background gives two.` });
  }
  if (!String(data.feature ?? "").trim()) {
    out.push({ level: "note", text: "No feature: every SRD background names one (the Acolyte's Shelter of the Faithful)." });
  }
  const purse = num(grants.purse);
  if (purse > 25) {
    out.push({ level: "note", text: `Starts with ${purse} gp: SRD backgrounds start with 5 to 25.` });
  }
  return out;
}

export function speciesFindings(data: Data): Finding[] {
  const out: Finding[] = [];
  const parsed = raceMechanics(data);
  const fixed = Object.values(parsed.asi).reduce((sum, value) => sum + (value ?? 0), 0);
  const chosen = (parsed.asiChoice?.count ?? 0) * (parsed.asiChoice?.amount ?? 0);
  const biggest = Math.max(0, ...Object.values(parsed.asi).map((value) => value ?? 0), parsed.asiChoice?.amount ?? 0);
  if (biggest > 2) {
    out.push({ level: "warn", text: `Raises one score by ${biggest}: no SRD race raises a score by more than 2.` });
  }
  if (fixed + chosen > 6) {
    out.push({ level: "warn", text: `+${fixed + chosen} to scores in all: the human's +1 to every score (+6) is the most any SRD race gives.` });
  } else if (fixed + chosen < 2) {
    out.push({ level: "note", text: `+${fixed + chosen} to scores in all: SRD races give +3 (the human +6).` });
  }
  if (parsed.speed < 25 || parsed.speed > 35) {
    out.push({ level: "note", text: `Walks ${parsed.speed} feet: SRD races walk 25 to 35.` });
  }
  if (parsed.size && parsed.size !== "Small" && parsed.size !== "Medium") {
    out.push({ level: "warn", text: `${parsed.size}: the SRD's playable races are Small or Medium, and the engines treat any other size as Medium for a character.` });
  }
  const skills = (parsed.skills?.length ?? 0) + (parsed.skillChoice?.count ?? 0);
  if (skills > 2) {
    out.push({ level: "note", text: `Grants ${skills} skills: the most any SRD race grants is two (the half-elf's Skill Versatility).` });
  }
  // The table reads a resistance from a trait's name, never from its words.
  for (const { trait, types } of unreadResistances(String(data.traits ?? ""))) {
    out.push({
      level: "warn",
      text: `${trait} says it resists ${types.join(" and ")} damage, but the table reads a resistance from a trait's name: pick it under "Add a resistance", or call the trait "${types.map((type) => `${type.charAt(0).toUpperCase()}${type.slice(1)}`).join(" and ")} Resistance".`,
    });
  }
  return out;
}

const ABILITY_NAMES: Record<string, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"];
const counted = (count: number, one: string, many = `${one}s`) => `${COUNT_WORDS[count] ?? count} ${count === 1 ? one : many}`;
const listed = (items: string[], last: "and" | "or") =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}` : (items[0] ?? "");
const titled = (name: string) => name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

// A feat's grants as the builder reads them from its words.
export function featGrantWords(desc: string): string[] {
  const out: string[] = [];
  const increase = featAbilityIncreaseFrom(desc);
  if (increase) {
    out.push(increase.from.length >= 6 ? "+1 to an ability score of the player's choice" : `+1 to ${listed(increase.from.map((ability) => ABILITY_NAMES[ability] ?? ability), "or")}`);
  }
  const spec = featGrantSpec(desc);
  if (spec.fixedSkills.length) out.push(`proficiency in ${listed(spec.fixedSkills.map(titled), "and")}`);
  if (spec.skills) out.push(`${counted(spec.skills, "skill")} of the player's choice`);
  if (spec.expertise || spec.fixedExpertise.length || spec.pickedExpertise) out.push("expertise");
  if (spec.fixedTools.length) out.push(`proficiency with ${listed(spec.fixedTools, "and")}`);
  if (spec.tools) out.push(`${counted(spec.tools, "tool")} of the player's choice`);
  if (spec.fixedLanguages.length) out.push(listed(spec.fixedLanguages, "and"));
  if (spec.languages) out.push(`${counted(spec.languages, "language")} of the player's choice`);
  if (spec.armor.length) out.push(`${listed(spec.armor.map((armor) => (armor === "shields" ? "shields" : `${armor} armor`)), "and")} training`);
  if (spec.fixedWeapons.length) out.push(spec.fixedWeapons.length > 3 ? `${spec.fixedWeapons.length} weapons` : `proficiency with ${listed(spec.fixedWeapons, "and")}`);
  if (spec.weapons) out.push(`${counted(spec.weapons, "weapon")} of the player's choice`);
  if (spec.any) out.push(`${COUNT_WORDS[spec.any] ?? spec.any} ${listed(spec.anyKinds, "or")} in any combination`);
  const taught = spec.taught;
  if (taught.fixedCantrips.length) out.push(`the ${listed(taught.fixedCantrips.map(titled), "and")} cantrip${taught.fixedCantrips.length === 1 ? "" : "s"}`);
  if (taught.cantrips) out.push(`${counted(taught.cantrips, "cantrip")} of the player's choice`);
  if (taught.fixedSpells.length) out.push(`the ${listed(taught.fixedSpells.map(titled), "and")} spell${taught.fixedSpells.length === 1 ? "" : "s"}`);
  if (taught.spells) out.push(`${counted(taught.spells, `level ${taught.spellLevel} spell`)} of the player's choice`);
  if (spec.damageTypes.length) out.push(`a choice of ${listed(spec.damageTypes, "or")} damage`);
  return out;
}

export function subclassFindings(data: Data): Finding[] {
  const out: Finding[] = [];
  const classId = String(data.classSlug ?? "");
  const levels = Object.keys(rec(data.levels)).map(Number).filter((level) => Number.isFinite(level));
  const first = subclassLevelFor(classId);
  if (first !== null && levels.some((level) => level < first)) {
    out.push({ level: "warn", text: `A feature before ${first}${first === 1 ? "st" : first === 2 ? "nd" : first === 3 ? "rd" : "th"} level: a ${classId} takes their subclass at ${first}, so it is never granted.` });
  }
  // The levels the class's published subclasses grant at.
  const published = subclassNamesFor(classId)[0];
  if (published) {
    const base = new Set(classFeaturesFor(classId, "", 20).map((feature) => `${feature.level}:${feature.name}`));
    const subclassLevels = [
      ...new Set(
        classFeaturesFor(classId, published, 20)
          .filter((feature) => !base.has(`${feature.level}:${feature.name}`))
          .map((feature) => feature.level)
          .filter((level): level is number => typeof level === "number"),
      ),
    ].sort((a, b) => a - b);
    const missing = subclassLevels.filter((level) => !levels.includes(level));
    if (missing.length && levels.length) {
      out.push({ level: "note", text: `${classId.charAt(0).toUpperCase()}${classId.slice(1)} subclasses grant features at ${subclassLevels.join(", ")}; this one has none at ${missing.join(", ")}.` });
    }
  }
  if (!levels.length) {
    out.push({ level: "warn", text: "No features: a character who takes it is granted nothing." });
  }
  return out;
}

export function hazardFindings(data: Data): Finding[] {
  const out: Finding[] = [];
  const kind = String(data.hazardKind ?? "");
  const block = rec(data[kind]);
  if (kind === "trap") {
    const save = rec(block.save);
    const dc = num(save.dc);
    if (dc > 20) {
      out.push({ level: "warn", text: `DC ${dc}: beyond the SRD's deadly band (16 to 20).` });
    } else if (dc) {
      out.push({ level: "note", text: `DC ${dc}: ${dc <= 11 ? "a setback (10 to 11)" : dc <= 15 ? "dangerous (12 to 15)" : "deadly (16 to 20)"} by the SRD's trap table.` });
    }
    if (num(block.attackBonus) > 12) {
      out.push({ level: "warn", text: `+${num(block.attackBonus)} to hit: beyond the SRD's deadly band (+9 to +12).` });
    }
    if (!save.ability && block.attackBonus === undefined && !num(block.fallFeet) && !arr(block.hit).length && !arr(block.conditionsAlways).length) {
      out.push({ level: "warn", text: "It does nothing when sprung: give it a save, an attack, a fall or damage." });
    }
  } else if (kind === "poison") {
    if (num(block.dc) > 20) {
      out.push({ level: "note", text: `DC ${num(block.dc)}: the SRD's strongest poison (Purple Worm) is DC 19.` });
    }
    if (!block.damage && !arr(block.conditions).length) {
      out.push({ level: "warn", text: "No damage and no condition: a failed save costs nothing." });
    }
  } else if (kind === "disease") {
    if (!block.rest && !block.runsAs) {
      out.push({ level: "note", text: "No save after a long rest: only magic (lesser restoration) ends it." });
    }
    if (num(block.exhaustion) >= 3) {
      out.push({ level: "warn", text: `${num(block.exhaustion)} levels of exhaustion at once: at 3 a character has disadvantage on attacks and saves, and the SRD's diseases give 1.` });
    }
  }
  return out;
}

// A workshop class against the SRD's twelve: what none of them has together.
export function classFindings(data: Data): Finding[] {
  const out: Finding[] = [];
  const saves = Array.isArray(data.saves) ? (data.saves as string[]) : [];
  if (saves.length !== 2) {
    out.push({ level: "error", text: "A class is proficient in two saving throws: pick two different abilities." });
  }
  // Each SRD class pairs a common save (Dexterity, Constitution, Wisdom)
  // with a rarer one.
  const strong = ["dex", "con", "wis"];
  if (saves.length === 2 && saves.every((save) => strong.includes(save))) {
    out.push({ level: "warn", text: "Two of the three saves that come up most (Dexterity, Constitution, Wisdom): every SRD class takes one of them and one rarer one." });
  }
  const hitDie = Number(data.hitDie ?? 8);
  const casting = String(data.casterType ?? "none");
  const armor = Array.isArray(data.armor) ? (data.armor as string[]) : [];
  if (casting === "full" && (hitDie >= 10 || armor.includes("heavy"))) {
    out.push({ level: "warn", text: `A full caster with ${hitDie >= 10 ? `a d${hitDie} hit die` : "heavy armor"}: no SRD full caster has more than a d8 or wears heavy armor without a subclass.` });
  }
  const skills = rec(data.skillChoices) as { count?: unknown };
  if (Number(skills.count ?? 2) > 4) {
    out.push({ level: "warn", text: "More than four skill picks: the rogue's four are the most any SRD class gives." });
  }
  if (!Object.keys(rec(data.levels)).length) {
    out.push({ level: "warn", text: "No features: a character of this class gains only hit points as they level." });
  }
  return out;
}
