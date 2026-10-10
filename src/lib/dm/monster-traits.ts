// Monster traits the engine reads beyond the flags in monster-abilities.ts
// (docs/dnd-rules-audit-2026-10-09-extent.md, F21 and F22), and the list of
// what it does not, so the DM resolves those by hand and knows to.
//
//   - Lightning, Fire and Acid Absorption (the golems): damage of that type
//     heals the creature instead.
//   - Immutable Form (the golems): immune to any spell or effect that would
//     alter its form (Polymorph, True Polymorph).
//   - Limited Magic Immunity (the rakshasa): it can't be affected or detected
//     by spells of 6th level or lower unless it wishes to be.
//   - Martial Advantage (the hobgoblin): once per turn, 2d6 more on a weapon
//     hit against a creature within 5 feet of one of its allies that isn't
//     incapacitated.
//   - Surprise Attack (the bugbear, the doppelganger): a hit on a creature
//     it surprised, in the first round, deals the extra dice it prints.
//
// Pure: no I/O. Traits are stored as "Name. text" or "Name: text" lines.

type Traits = { traits?: string[] };

const line = (stats: Traits, name: RegExp) => (stats.traits ?? []).find((entry) => name.test(entry.trim()));

// The damage types the creature absorbs.
export function absorbedTypes(stats: Traits): string[] {
  return (stats.traits ?? [])
    .map((entry) => /^(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) absorption\b/i.exec(entry.trim())?.[1]?.toLowerCase())
    .filter((type): type is string => Boolean(type));
}

export function absorbs(stats: Traits, damageType: string | undefined): boolean {
  const type = (damageType ?? "").trim().toLowerCase();
  return Boolean(type) && absorbedTypes(stats).includes(type);
}

export function immutableForm(stats: Traits): boolean {
  return Boolean(line(stats, /^immutable form\b/i));
}

// The highest spell level the creature shrugs off, or null.
export function magicImmunityLevel(stats: Traits): number | null {
  const found = line(stats, /^limited magic immunity\b/i);
  if (!found) {
    return null;
  }
  const level = /spells? of (\d)(?:st|nd|rd|th) level or lower/i.exec(found);
  return level ? Number(level[1]) : 6;
}

// Why a spell of this level cannot touch the creature, or null.
export function magicImmunityProblem(enemy: { displayName: string; stats: Traits }, spell: string, level: number): string | null {
  const cap = magicImmunityLevel(enemy.stats);
  if (cap === null || level > cap) {
    return null;
  }
  return `${enemy.displayName} can't be affected or detected by spells of ${ordinal(cap)} level or lower (Limited Magic Immunity), and ${spell} is cast at ${level ? `${ordinal(level)} level` : "cantrip level"}. Nothing was spent; a spell from a higher slot reaches it.`;
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

// Martial Advantage's dice, or null for a block without it.
export function martialAdvantageDice(stats: Traits): string | null {
  const found = line(stats, /^martial advantage\b/i);
  if (!found) {
    return null;
  }
  return /\((\d+d\d+)\)/.exec(found)?.[1] ?? /(\d+d\d+)/.exec(found)?.[1] ?? "2d6";
}

// Surprise Attack's dice, or null.
export function surpriseAttackDice(stats: Traits): string | null {
  const found = line(stats, /^surprise attack\b/i);
  if (!found) {
    return null;
  }
  return /\((\d+d\d+)\)/.exec(found)?.[1] ?? /(\d+d\d+)/.exec(found)?.[1] ?? "2d6";
}

// The names the engine resolves itself, by trait name at the start of a
// line. Anything else on the block is the DM's to apply by hand.
const ENGINE_READS = [
  /^magic resistance\b/i, /^pack tactics\b/i, /^nimble escape\b/i, /^sunlight sensitivity\b/i,
  /^undead fortitude\b/i, /^regeneration\b/i, /^magic weapons\b/i, /^legendary resistance\b/i,
  /^spellcasting\b/i, /^innate spellcasting\b/i, /^keen (?:sight|hearing|smell|senses)/i,
  /^(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) absorption\b/i,
  /^immutable form\b/i, /^limited magic immunity\b/i, /^martial advantage\b/i, /^surprise attack\b/i,
  /^shapechanger\b/i, /^reaction:\s*parry\b/i, /^legendary action/i, /^lair action/i,
  /^(?:the \w+ can take \d+ legendary actions)/i, /^multiattack\b/i,
];

// The block's lines the engine does not read, each as its name: the DM's to
// apply (the GAME STATE line and the DM's view show them as manual).
export function manualTraits(stats: Traits & { fullTraits?: string[] }): string[] {
  return (stats.fullTraits?.length ? stats.fullTraits : stats.traits ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry && !ENGINE_READS.some((pattern) => pattern.test(entry)))
    .map((entry) => (/^(?:(?:reaction|bonus action|legendary action|lair action|action)s?:\s*)?([^.:(]{2,60}?)(?:\s*\([^)]*\))?\s*[.:]/i.exec(entry)?.[1] ?? entry.slice(0, 40)).trim())
    .filter((name, index, list) => list.indexOf(name) === index);
}
