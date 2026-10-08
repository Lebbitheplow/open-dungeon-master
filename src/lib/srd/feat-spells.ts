// The spells a feat teaches, read from its text the way feat-grants.ts reads
// its languages and tools (issue #125): Fey Touched's misty step and one
// 1st-level divination or enchantment spell, Shadow Touched's invisibility,
// Spell Sniper's attack cantrip, Magic Initiate's two cantrips and a
// 1st-level spell from one class list, Ritual Caster's two ritual spells.
//
// The picks are stored on the sheet as featChoices[feat].cantrips / .spells
// (plus .list and .ability where the feat leaves those open), and the
// spells themselves are written into the sheet's spellcasting lists so the
// cast tools find them: cantrips with the cantrips, spells with the known
// spells, a ritual book's with the spellbook. They ride on top of the
// class's own counts, as a race's cantrip does.
//
// A spell the feat lets the character "cast once without a slot" gets a
// Free cast feature ("Free cast: Misty Step (Fey Touched)"), which
// class-resources.ts turns into a once-per-long-rest counter the cast guard
// spends instead of a slot. Pure.
import type { Ability } from "@/lib/schemas/sheet";

// The scores a spell is cast with.
export type CastingAbility = "int" | "wis" | "cha";
const CASTING: CastingAbility[] = ["int", "wis", "cha"];
const castingAbility = (ability: Ability | null | undefined): CastingAbility | null =>
  ability && (CASTING as string[]).includes(ability) ? (ability as CastingAbility) : null;

export type FeatSpellSpec = {
  // Cantrips the player names, and whether each must be an attack cantrip.
  cantrips: number;
  attackCantrip: boolean;
  // Levelled spells the player names, and their level.
  spells: number;
  spellLevel: number;
  // Schools the levelled picks are drawn from ("divination", "enchantment");
  // empty for any school.
  schools: string[];
  // Class lists the picks come from; empty for any list. With listChoice the
  // player names ONE of them and every pick comes from it (Magic Initiate,
  // Ritual Caster); without it any of the lists will do (Spell Sniper).
  lists: string[];
  listChoice: boolean;
  // Spells the feat hands over by name ("misty step").
  fixedSpells: string[];
  // Every levelled spell (fixed and picked) is castable once per long rest
  // without a slot.
  freeCast: boolean;
  // The spells sit in a ritual book and are cast only as rituals.
  ritualBook: boolean;
  // How the casting ability is settled: the player names it, it follows the
  // class list chosen, or it is the score the feat raised.
  ability: "choice" | "list" | "raised";
};

export type FeatSpellPicks = {
  cantrips?: string[];
  spells?: string[];
  list?: string;
  ability?: CastingAbility;
};

const EMPTY: FeatSpellSpec = {
  cantrips: 0, attackCantrip: false, spells: 0, spellLevel: 1, schools: [], lists: [], listChoice: false,
  fixedSpells: [], freeCast: false, ritualBook: false, ability: "raised",
};

const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const count = (word: string | undefined) => (word ? (COUNTS[word.toLowerCase()] ?? Number(word) ?? 0) : 0);

export const SPELL_LISTS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard", "artificer"];
const SCHOOLS = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];

// The ability a class list casts with (SRD 5.1 Magic Initiate: "Charisma
// for bard, sorcerer, or warlock; Wisdom for cleric or druid; Intelligence
// for wizard").
export function listAbility(list: string): CastingAbility {
  const name = lower(list);
  if (["cleric", "druid", "ranger"].includes(name)) return "wis";
  if (["wizard", "artificer"].includes(name)) return "int";
  return "cha";
}

const lower = (value: string) => value.trim().toLowerCase().replace(/[‘’]/g, "'");

const namesIn = (clause: string, from: string[]) => from.filter((name) => new RegExp(`\\b${name}\\b`).test(clause));

export function featSpellsAnything(spec: FeatSpellSpec): boolean {
  return spec.cantrips + spec.spells + spec.fixedSpells.length > 0;
}

// The spells a feat's text teaches. The clauses ODM's feats and the packs
// use: "you learn misty step and one 1st-level divination or enchantment
// spell", "learn one attack cantrip from the bard, cleric ... list", "learn
// two cantrips of your choice from the Cleric, Druid, or Wizard spell list",
// "choose a level 1 spell from the same list", "a ritual book holding two
// 1st-level ritual spells from a class you choose". Any other wording
// teaches nothing here.
export function featSpellSpec(desc: string): FeatSpellSpec {
  const text = lower(desc ?? "").replace(/\s+/g, " ");
  if (!text) {
    return EMPTY;
  }
  const spec: FeatSpellSpec = { ...EMPTY, schools: [], lists: [], fixedSpells: [] };

  // "You learn misty step and one 1st-level divination or enchantment spell"
  const learnNamed = /\byou learn ([a-z' ]+?) and (one|two|a) (?:(\d)(?:st|nd|rd|th)-level|level (\d)) ([a-z]+)(?: or ([a-z]+))? spell/.exec(text);
  if (learnNamed) {
    spec.fixedSpells.push(learnNamed[1].trim());
    spec.spells = count(learnNamed[2]);
    spec.spellLevel = Number(learnNamed[3] ?? learnNamed[4] ?? 1);
    spec.schools = namesIn([learnNamed[5], learnNamed[6] ?? ""].join(" "), SCHOOLS);
  }

  // "choose a class: bard, cleric, ..." / "from a class you choose"
  const classChoice = /\bchoose a class:? ([a-z, ]+?)\.|\bfrom a class you choose\b|\bfrom the same list\b|\bthat class's spell list\b/.exec(text);
  if (classChoice) {
    spec.listChoice = true;
    if (classChoice[1]) {
      spec.lists = namesIn(classChoice[1], SPELL_LISTS);
    }
  }

  // "learn two cantrips of your choice from the Cleric, Druid, or Wizard spell list"
  // "learn one attack cantrip from the bard, cleric, druid, sorcerer, warlock or wizard list"
  const cantrips = /\blearn (one|two|three) (attack )?cantrips?(?: of your choice)? from (?:the )?([a-z,' ]+?) (?:spell )?lists?\b/.exec(text);
  if (cantrips) {
    spec.cantrips = count(cantrips[1]);
    spec.attackCantrip = Boolean(cantrips[2]);
    const lists = namesIn(cantrips[3], SPELL_LISTS);
    if (lists.length) {
      spec.lists = lists;
    }
  }

  // "choose one 1st-level spell from that same list" / "Choose a level 1
  // spell from the same list" / "two 1st-level ritual spells from a class"
  const picks = /\b(?:choose|learn|holding) (one|two|a) (?:(\d)(?:st|nd|rd|th)-level|level (\d)) (ritual )?spells?\b/.exec(text);
  if (picks && !learnNamed) {
    spec.spells = count(picks[1]);
    spec.spellLevel = Number(picks[2] ?? picks[3] ?? 1);
    if (picks[4] || /\britual book\b/.test(text)) {
      spec.ritualBook = true;
    }
    if (!spec.lists.length) {
      const from = /spells? from (?:the )?([a-z,' ]+?) (?:spell )?lists?\b/.exec(text);
      spec.lists = from ? namesIn(from[1], SPELL_LISTS) : [];
    }
  }
  if (spec.listChoice && !spec.lists.length && (spec.cantrips || spec.spells)) {
    spec.lists = ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"];
  }

  spec.freeCast =
    /\bcastable once per long rest without a slot\b|\bcast it once without (?:expending )?a spell slot\b|\bonce without (?:expending )?a spell slot\b|\bmust finish a long rest before you can cast it again\b/.test(text) &&
    spec.spells + spec.fixedSpells.length > 0 && !spec.ritualBook;

  if (/\b(?:intelligence|wisdom|charisma)(?:, (?:wisdom|charisma))*,? or (?:wisdom|charisma) is your spellcasting ability\b|\bchoose (?:intelligence|wisdom|charisma)\b.*\bspellcasting ability\b/.test(text)) {
    spec.ability = "choice";
  } else if (/\bspellcasting ability for these spells depends on the class\b|\bcharisma for bard\b/.test(text)) {
    spec.ability = "list";
  } else {
    spec.ability = "raised";
  }
  return spec;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ordinal = (level: number) => (level === 1 ? "1st" : level === 2 ? "2nd" : level === 3 ? "3rd" : `${level}th`);

// What the player has yet to name for the feat's spells, as the sentence
// the gate shows, or null.
export function featSpellsOwed(feat: string, spec: FeatSpellSpec, picks: FeatSpellPicks | undefined): string | null {
  if (!featSpellsAnything(spec)) {
    return null;
  }
  const has = (list: string[] | undefined) => (list ?? []).filter((entry) => entry && entry.trim()).length;
  const owed: string[] = [];
  if (spec.listChoice && !(picks?.list ?? "").trim()) {
    owed.push("a class list");
  }
  if (spec.ability === "choice" && !picks?.ability) {
    owed.push("a spellcasting ability");
  }
  if (spec.cantrips > has(picks?.cantrips)) {
    owed.push(plural(spec.cantrips - has(picks?.cantrips), spec.attackCantrip ? "attack cantrip" : "cantrip"));
  }
  if (spec.spells > has(picks?.spells)) {
    const kind = spec.schools.length ? `${spec.schools.join(" or ")} ` : "";
    owed.push(plural(spec.spells - has(picks?.spells), `${ordinal(spec.spellLevel)}-level ${kind}${spec.ritualBook ? "ritual " : ""}spell`));
  }
  return owed.length ? `${feat}: pick ${owed.join(", ")}.` : null;
}

// A spell the legality judge can see: its level, class lists, school and
// ritual tag where known.
export type KnownSpell = { name: string; level: number; classes: string[]; school?: string | null; ritual?: boolean };

export type FeatSpellGrant = {
  feat: string;
  cantrips: string[];
  // Levelled spells known outright (cast with slots, or free once a day).
  spells: string[];
  // Spells in a ritual book, cast only as rituals.
  rituals: string[];
  // The spells with a free cast once per long rest.
  freeCasts: string[];
  // The class list the picks came from, where the feat asked for one.
  list: string | null;
  ability: CastingAbility | null;
};

export type FeatSpellInput = {
  feats: Array<{ name: string; desc: string }>;
  choices: Record<string, FeatSpellPicks | undefined>;
  // The score a half-feat raised, for the feats whose spells use it.
  raisedAbility: (feat: string) => Ability | null;
  // Resolves a spell name, for the strict checks; null when unknown.
  spellOf?: (name: string) => KnownSpell | null;
  // Strict: every pick is named, is a real spell, and is one the feat
  // offers. Otherwise what is named is taken as it is.
  strict: boolean;
};

export type FeatSpellVerdict = { grants: FeatSpellGrant[]; problems: string[] };

// The spells every feat on the sheet teaches, with the picks as recorded.
export function featSpellGrants(input: FeatSpellInput): FeatSpellVerdict {
  const problems: string[] = [];
  const grants: FeatSpellGrant[] = [];
  for (const feat of input.feats) {
    const spec = featSpellSpec(feat.desc);
    if (!featSpellsAnything(spec)) {
      continue;
    }
    const picks = input.choices[lower(feat.name)] ?? input.choices[feat.name] ?? {};
    if (input.strict) {
      const owed = featSpellsOwed(feat.name, spec, picks);
      if (owed) {
        problems.push(owed);
      }
    }
    const list = spec.listChoice ? lower(picks.list ?? "") || null : null;
    if (input.strict && list && spec.lists.length && !spec.lists.includes(list)) {
      problems.push(`${feat.name}'s spells come from the ${spec.lists.join(", ")} list; "${picks.list}" is not one of them.`);
    }
    const allowedLists = list ? [list] : spec.lists;
    const check = (name: string, level: number, kind: string): KnownSpell | null => {
      const known = input.spellOf?.(name) ?? null;
      if (!input.strict) {
        return known;
      }
      if (!known) {
        problems.push(`"${name}" is not a spell the server knows; ${feat.name}'s ${kind} is picked from the spell list.`);
        return null;
      }
      if (known.level !== level) {
        problems.push(`${known.name} is a ${known.level === 0 ? "cantrip" : `level ${known.level} spell`}; ${feat.name}'s ${kind} is ${level === 0 ? "a cantrip" : `a ${ordinal(level)}-level spell`}.`);
      }
      if (allowedLists.length && !known.classes.some((entry) => allowedLists.includes(lower(entry)))) {
        problems.push(`${known.name} is not on the ${allowedLists.join(" or ")} list, which is where ${feat.name}'s ${kind} comes from.`);
      }
      return known;
    };
    const cantrips = (picks.cantrips ?? []).map((name) => name.trim()).filter(Boolean).slice(0, spec.cantrips);
    for (const name of cantrips) {
      check(name, 0, spec.attackCantrip ? "attack cantrip" : "cantrip");
    }
    const picked = (picks.spells ?? []).map((name) => name.trim()).filter(Boolean).slice(0, spec.spells);
    for (const name of picked) {
      const known = check(name, spec.spellLevel, spec.ritualBook ? "ritual spell" : "spell");
      if (input.strict && known && spec.schools.length && known.school && !spec.schools.includes(lower(known.school))) {
        problems.push(`${known.name} is a ${lower(known.school)} spell; ${feat.name}'s spell is picked from ${spec.schools.join(" or ")}.`);
      }
      if (input.strict && known && spec.ritualBook && known.ritual === false) {
        problems.push(`${known.name} has no ritual tag; ${feat.name}'s book holds rituals only.`);
      }
    }
    const fixed = spec.fixedSpells.map((name) => input.spellOf?.(name)?.name ?? capital(name));
    const named = [...fixed, ...picked.map((name) => input.spellOf?.(name)?.name ?? name)];
    const ability: CastingAbility | null =
      spec.ability === "choice"
        ? (picks.ability ?? null)
        : spec.ability === "list"
          ? (list ? listAbility(list) : null)
          : (castingAbility(input.raisedAbility(feat.name)) ?? picks.ability ?? null);
    grants.push({
      feat: feat.name,
      cantrips: cantrips.map((name) => input.spellOf?.(name)?.name ?? name),
      spells: spec.ritualBook ? [] : named,
      rituals: spec.ritualBook ? named : [],
      freeCasts: spec.freeCast ? named : [],
      list,
      ability,
    });
  }
  return { grants, problems };
}

const capital = (value: string) => value.replace(/(^|\s|')([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);

// ---- the free cast, as a feature and a counter ----

export const FREE_CAST_PREFIX = "Free cast: ";
const FREE_CAST_PATTERN = /^free cast: (.+?) \((.+)\)$/i;

export function freeCastFeatureName(spell: string, feat: string): string {
  return `${FREE_CAST_PREFIX}${spell} (${feat})`;
}

// The spell and feat a Free cast feature names, or null.
export function freeCastOf(featureName: string): { spell: string; feat: string } | null {
  const match = FREE_CAST_PATTERN.exec(featureName.trim());
  return match ? { spell: match[1], feat: match[2] } : null;
}

const slug = (name: string) => lower(name).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function freeCastResourceId(spell: string): string {
  return `free_cast_${slug(spell)}`;
}

export function isFreeCastResource(id: string): boolean {
  return id.startsWith("free_cast_");
}

// The spell a free-cast counter id names, in words ("misty step").
export function freeCastSpellOf(id: string): string {
  return id.replace(/^free_cast_/, "").replace(/_/g, " ");
}

// Every Free cast feature the grants call for.
export function freeCastFeatures(grants: FeatSpellGrant[]): string[] {
  return grants.flatMap((grant) => grant.freeCasts.map((spell) => freeCastFeatureName(spell, grant.feat)));
}

// ---- the sheet's lists with the feat spells in ----

export type SpellLists = {
  ability: CastingAbility;
  slots: Record<string, { max: number; used: number }>;
  cantrips: string[];
  known: string[];
  prepared: string[];
  pending?: string[];
  spellbook?: string[];
};

const has = (list: string[] | undefined, name: string) => (list ?? []).some((entry) => lower(entry) === lower(name));

// The lists with every feat spell in its place: cantrips with the
// cantrips, spells with the known, a ritual book's with the spellbook. A
// character with no Spellcasting of their own gets a block with no slots
// and the feat's ability, so the cast tools treat the spells as held.
export function withFeatSpells<T extends SpellLists>(lists: T | null, grants: FeatSpellGrant[]): T | null {
  const cantrips = grants.flatMap((grant) => grant.cantrips);
  const spells = grants.flatMap((grant) => grant.spells);
  const rituals = grants.flatMap((grant) => grant.rituals);
  if (!cantrips.length && !spells.length && !rituals.length) {
    return lists;
  }
  const base: SpellLists =
    lists ?? {
      ability: grants.find((grant) => grant.ability)?.ability ?? "cha",
      slots: {},
      cantrips: [],
      known: [],
      prepared: [],
    };
  const next: SpellLists = {
    ...base,
    cantrips: [...(base.cantrips ?? []), ...cantrips.filter((name) => !has(base.cantrips, name))],
    known: [...base.known, ...spells.filter((name) => !has(base.known, name) && !has(base.prepared, name))],
  };
  if (rituals.length) {
    next.spellbook = [...(base.spellbook ?? []), ...rituals.filter((name) => !has(base.spellbook, name))];
  }
  return next as T;
}

// The lists without the feats' spells: what an edit or a re-pick starts
// from, so a changed pick replaces the old one rather than piling on.
export function withoutFeatSpells<T extends SpellLists>(lists: T | null, grants: FeatSpellGrant[]): T | null {
  if (!lists) {
    return lists;
  }
  const drop = new Set(grants.flatMap((grant) => [...grant.cantrips, ...grant.spells, ...grant.rituals]).map(lower));
  if (!drop.size) {
    return lists;
  }
  const keep = (list: string[] | undefined) => (list ?? []).filter((entry) => !drop.has(lower(entry)));
  return {
    ...lists,
    cantrips: keep(lists.cantrips),
    known: keep(lists.known),
    prepared: keep(lists.prepared),
    ...(lists.spellbook ? { spellbook: keep(lists.spellbook) } : {}),
  };
}

// Every spell name the grants hold, for the counts that leave them out.
export function featSpellNames(grants: FeatSpellGrant[]): { cantrips: string[]; spells: string[] } {
  return {
    cantrips: grants.flatMap((grant) => grant.cantrips),
    spells: grants.flatMap((grant) => [...grant.spells, ...grant.rituals]),
  };
}
