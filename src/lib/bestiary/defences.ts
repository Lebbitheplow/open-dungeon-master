// A pack row's four defence lines read into the words the engine knows
// (src/lib/dm/damage-logic.ts lineCovers, and the condition lines every
// save and condition tool checks by name). The documents print them every
// which way: Black Flag lists conditions among its damage immunities
// ("poison,poisoned"), resistances to conditions among its damage
// resistances ("charmed,frightened") and points at a trait instead of
// listing anything ("Devilish Resilience"); Tome of Beasts 2023 stores the
// word "false" in an empty field; Tome of Beasts 3 abbreviates
// ("nonmagic b/p/s attacks not made w/silvered weapons"); A5e writes
// "damage from nonmagical weapons" for the three weapon types; and condition
// immunities come as "fatigue", "exhausted", "paralysis" or "blindness".
// Pure, so the readers' tests drive it.

import { textKey } from "@/lib/language/text-logic";

const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
const PHYSICAL = "bludgeoning, piercing, and slashing";

// The conditions a block can be immune or resistant to, exhaustion among
// them, by the SRD's name.
const CONDITIONS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
];

// Other words for them: A5e's fatigue is the SRD's exhaustion, and a few
// blocks name the condition by its noun. "poison" here is only ever read in
// a condition line, where it means poisoned.
const CONDITION_WORDS: Record<string, string> = {
  blind: "blinded",
  blindness: "blinded",
  deaf: "deafened",
  deafness: "deafened",
  exhausted: "exhaustion",
  fatigue: "exhaustion",
  fatigued: "exhaustion",
  frightening: "frightened",
  fear: "frightened",
  paralysis: "paralyzed",
  paralyzation: "paralyzed",
  petrification: "petrified",
  poison: "poisoned",
  charm: "charmed",
  stun: "stunned",
};

export type BlockDefences = {
  resist: string;
  immune: string;
  vulnerable: string;
  conditionImmune: string;
  // Black Flag's resistance and vulnerability to a condition: advantage, or
  // disadvantage, on a save against it (src/lib/dm/forced-save.ts).
  conditionResist?: string;
  conditionVulnerable?: string;
};

type Trait = { name?: unknown; desc?: unknown };

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const wholeWord = (text: string, word: string) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(text);

// A condition's SRD name, or null for a word that is no condition.
export function conditionWord(raw: string): string | null {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/\s*\((?:see|with)\b[^)]*\)\s*$/, "")
    .replace(/\s+condition$/, "");
  if (CONDITIONS.includes(word)) {
    return word;
  }
  return CONDITION_WORDS[word] ?? null;
}

// The shorthand and misspellings of the documents, spelled the way the
// damage reader matches them.
function spelled(text: string): string {
  return text
    .replace(/&amp;?/gi, "and")
    .replace(/&/g, "and")
    .replace(/\bb\s*\/\s*p\s*\/\s*s\b/gi, PHYSICAL)
    .replace(/\bw\//gi, "with ")
    .replace(/\blighting\b/gi, "lightning")
    .replace(/\bpiericing\b/gi, "piercing")
    .replace(/\bnomagical\b/gi, "nonmagical")
    .replace(/\bnon[\s-]?magic(?:al)?\b/gi, "nonmagical")
    .replace(/\bnonmagical\s*\/\s*nonsilver(?:ed)? weapons\b/gi, "nonmagical attacks not made with silvered weapons")
    .replace(/\s+/g, " ")
    .trim();
}

// A5e's "damage from nonmagical weapons", "damage from nonmagical,
// non-silvered weapons": the three weapon types, which the damage reader
// needs named.
function weaponClause(clause: string): string {
  const bare = /^(?:all\s+)?damage from nonmagical(?:,?\s*(?:and\s+)?non-?(silvered|adamantine))? weapons$/i.exec(clause.trim());
  if (bare) {
    return `${PHYSICAL} from nonmagical attacks${bare[1] ? ` not made with ${bare[1].toLowerCase()} weapons` : ""}`;
  }
  // A vulnerability to "silvered weapons" (Tome of Beasts) is to their blows.
  if (/^(?:damage from )?silvered weapons$/i.test(clause.trim())) {
    return `${PHYSICAL} from silvered weapons`;
  }
  // "piercing and slashing damage from nonmagical, non-adamantine weapons".
  return clause.replace(/\bnonmagical,?\s*(?:and\s+)?non-?(silvered|adamantine) weapons\b/gi, (_, material: string) => `nonmagical attacks not made with ${material.toLowerCase()} weapons`);
}

// What a Black Flag defence trait says ("The devil is resistant to cold
// damage and to bludgeoning, piercing, and slashing damage from nonmagical
// attacks. In addition, it is immune to fire damage and poison damage and to
// the poisoned condition."), as damage lines and condition lists.
type Read = { resist: string[]; immune: string[]; vulnerable: string[]; conditionImmune: string[]; conditionResist: string[]; conditionVulnerable: string[] };

function traitDefences(text: string, into: Read) {
  const clauses = spelled(text).split(/\.\s+|;\s+|,?\s+and it (?:is|has)\s+|\bin addition,\s*/i);
  for (const clause of clauses) {
    const found = /\b(resistant|immune|vulnerable) to (.+)$/i.exec(clause);
    if (!found) {
      continue;
    }
    const kind = found[1].toLowerCase() as "resistant" | "immune" | "vulnerable";
    const body = found[2];
    const conditions = CONDITIONS.filter((condition) => wholeWord(body, condition));
    const types = DAMAGE_TYPES.filter((type) => wholeWord(body, type));
    const physical = types.filter((type) => PHYSICAL.includes(type));
    const other = types.filter((type) => !PHYSICAL.includes(type));
    const lines: string[] = [];
    if (other.length) {
      lines.push(other.join(", "));
    }
    if (physical.length) {
      const qualifier = /from nonmagical [^,.;]*?(?:attacks|weapons)(?: (?:not made with|that aren't) [a-z ]+? weapons)?/i.exec(body)?.[0];
      lines.push(`${physical.join(", ")}${qualifier ? ` ${qualifier}` : ""}`);
    }
    const lists = {
      resistant: [into.resist, into.conditionResist],
      immune: [into.immune, into.conditionImmune],
      vulnerable: [into.vulnerable, into.conditionVulnerable],
    } as const;
    lists[kind][0].push(...lines);
    lists[kind][1].push(...conditions);
  }
}

// One damage line's parts, each a condition, a trait the block points at,
// or damage words kept as they read.
function readDamageLine(raw: string, traits: Trait[], into: Read, field: "resist" | "immune" | "vulnerable") {
  const text = spelled(raw);
  if (!text || /^false$/i.test(text)) {
    return;
  }
  const conditionList = field === "resist" ? into.conditionResist : field === "immune" ? into.conditionImmune : into.conditionVulnerable;
  const kept: string[] = [];
  for (const clause of text.split(/\s*;\s*/)) {
    const parts: string[] = [];
    for (const part of clause.split(/\s*,\s*/)) {
      const condition = conditionWord(part);
      // "poison" in a damage line is the damage type, never the condition.
      if (condition && !/^poison$/i.test(part.trim())) {
        conditionList.push(condition);
        continue;
      }
      const trait = part.trim() ? traits.find((entry) => textKey(asString(entry.name)) === textKey(part)) : undefined;
      if (trait) {
        traitDefences(asString(trait.desc), into);
        continue;
      }
      parts.push(part);
    }
    const rest = weaponClause(parts.join(", ").replace(/^(?:and|or)\s+/i, "").trim());
    if (rest) {
      kept.push(rest);
    }
  }
  into[field].push(...kept);
}

function readConditionLine(raw: string, into: Read) {
  const text = spelled(raw);
  if (!text || /^false$/i.test(text)) {
    return;
  }
  // "prone poisoned" (a missing comma) is two conditions.
  for (const part of text.split(/\s*[,;]\s*|\s+(?:and|or)\s+/)) {
    const words = part.trim().split(/\s+/);
    const each = words.length > 1 && words.every((word) => conditionWord(word)) ? words : [part];
    for (const word of each) {
      const condition = conditionWord(word);
      if (condition) {
        into.conditionImmune.push(condition);
      } else if (DAMAGE_TYPES.includes(word.trim().toLowerCase())) {
        // A damage type filed with the conditions ("lightning").
        into.immune.push(word.trim().toLowerCase());
      } else if (word.trim()) {
        into.conditionImmune.push(word.trim().toLowerCase());
      }
    }
  }
}

const joined = (lines: string[]) => [...new Set(lines.map((line) => line.trim()).filter(Boolean))].join("; ");
const listed = (words: string[]) => [...new Set(words)].join(", ");

export function readDefences(data: Record<string, unknown>, traits: Trait[]): BlockDefences {
  const read: Read = { resist: [], immune: [], vulnerable: [], conditionImmune: [], conditionResist: [], conditionVulnerable: [] };
  readDamageLine(asString(data.damage_resistances), traits, read, "resist");
  readDamageLine(asString(data.damage_immunities), traits, read, "immune");
  readDamageLine(asString(data.damage_vulnerabilities), traits, read, "vulnerable");
  readConditionLine(asString(data.condition_immunities), read);
  // Immunity outranks resistance: a condition both lists name is immune.
  const conditionResist = read.conditionResist.filter((condition) => !read.conditionImmune.includes(condition));
  return {
    resist: joined(read.resist),
    immune: joined(read.immune),
    vulnerable: joined(read.vulnerable),
    conditionImmune: listed(read.conditionImmune),
    ...(conditionResist.length ? { conditionResist: listed(conditionResist) } : {}),
    ...(read.conditionVulnerable.length ? { conditionVulnerable: listed(read.conditionVulnerable) } : {}),
  };
}
