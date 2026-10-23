// What an undead's own block, and the blocks around it, do to its save
// against an effect that turns undead (Turn Undead, Destroy Undead, Turn the
// Unholy): Turn Resistance gives it advantage (the SRD lich), Turn Defiance
// gives it and the ghouls or undead near it advantage (the SRD ghast), Turn
// Vulnerability gives it disadvantage, and Turn Immunity leaves it unturned.
// Read from the block's own words, so the books' other names for them
// ("Turning Defiance", Tome of Beasts 3's "saves vs. turn undead") count the
// same. Run by the turning in src/lib/dm/feature-spends.ts.

import type { EncounterEnemy } from "@/lib/db/encounters";
import { withinFeet } from "@/lib/dm/authored-saves";
import { textKey, words } from "@/lib/language/text-logic";

// "saving throws against any effect that turns undead", "saves vs. turn
// undead", A5e's "saving throws against spells ... and against features that
// turn undead".
const AGAINST_TURNING = /(?:saving throws?|saves?) (?:against|vs\.?) (?:[^.]*?\b(?:effects?|features?) that turns? undead|turn undead\b)/i;
const IMMUNE = /\bimmune to (?:any )?effects? that turns? undead/i;
// "within 30 feet of it", "within 30 ft.", Tome of Beasts 3's "within 60'".
const AURA = /\bwithin (\d{1,3})\s*(?:ft\.?|feet|')/i;

export type TurnDefence = { immune?: string; advantage?: string; disadvantage?: string };

function turnLines(enemy: EncounterEnemy): string[] {
  const lines = [...(enemy.stats.fullTraits ?? []), ...(enemy.stats.traits ?? [])];
  return [...new Set(lines.filter((line) => AGAINST_TURNING.test(line) || IMMUNE.test(line)))];
}

// "Turn Defiance" of "Turn Defiance: The ghast and any ghouls ...".
const traitName = (line: string) => /^([^.:]{2,40})[.:]/.exec(line.trim())?.[1]?.trim() ?? "its block";

// The creatures an aura names besides its own ("any ghouls", "all darakhul
// or ghouls", "friendly undead", A5e's "allies"), each a word an ally's type
// or name must hold.
function auraKinds(before: string): string[] {
  const group = before
    .replace(/^.*?\b(?:the [^.:]*?|it)\s+and\s+/i, "")
    .replace(/\b(?:any|all|other|friendly)\s+/gi, "")
    .trim();
  return group.split(/\s+or\s+/i).map((kind) => textKey(kind)).filter(Boolean);
}

function isKind(enemy: EncounterEnemy, kind: string): boolean {
  if (kind === "allies" || kind === "ally") {
    return true;
  }
  if (kind === "undead") {
    return /^undead\b/i.test(String(enemy.stats.type ?? ""));
  }
  // "ghouls" is a ghoul, an iron ghoul or a bloated ghoul: a word of its name.
  const singular = kind.replace(/s$/, "");
  const names = [...words(enemy.displayName), ...words(enemy.slug.replace(/-/g, " "))].map((word) => textKey(word));
  return names.includes(kind) || names.includes(singular);
}

// The creature's own lines, and every living ally's aura that reaches it.
export function turnDefence(encounterId: string, enemy: EncounterEnemy, enemies: EncounterEnemy[]): TurnDefence {
  const out: TurnDefence = {};
  for (const line of turnLines(enemy)) {
    const name = traitName(line);
    if (IMMUNE.test(line)) {
      out.immune = name;
      continue;
    }
    const aura = AURA.exec(line);
    const before = aura ? line.slice(0, aura.index) : "";
    // An aura the creature is named in ("The ghast and any ghouls", "It and
    // any Undead"), or a line about it alone.
    const self = !aura || /\b(?:the [^.:]*?|it)\s+and\s+(?:any|all|allies)\b/i.test(before);
    if (!self) {
      continue;
    }
    if (/\bdisadvantage\b/i.test(line)) {
      out.disadvantage = name;
    } else {
      out.advantage = name;
    }
  }
  if (out.immune || out.advantage) {
    return out;
  }
  for (const ally of enemies) {
    if (ally.id === enemy.id || ally.status !== "alive") {
      continue;
    }
    for (const line of turnLines(ally)) {
      const aura = AURA.exec(line);
      if (!aura || /\bdisadvantage\b/i.test(line) || !auraKinds(line.slice(0, aura.index).replace(/^[^:]*:\s*/, "")).some((kind) => isKind(enemy, kind))) {
        continue;
      }
      if (withinFeet(encounterId, ally.id, enemy.id, Number(aura[1]))) {
        out.advantage = `${ally.displayName}'s ${traitName(line)}`;
        return out;
      }
    }
  }
  return out;
}
