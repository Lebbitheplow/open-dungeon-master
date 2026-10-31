// A monster's reading (reading-logic.ts): the stat block parseMonster reads
// from the row (with the pack's corrections in), cut to what the engine
// plays, and the entries whose numbers no reader took.

import { parseMonster, type EnemyStats } from "@/lib/bestiary/statblock";
import { hasPackCorrection } from "@/lib/bestiary/pack-corrections";
import { parseAttack } from "@/lib/bestiary/attack-parse";
import { spellOfAction } from "@/lib/dm/monster-abilities";
import { reading, readingChecked, type EntryReading, type ReadingRow } from "@/lib/content/reading-logic";
import { textKey } from "@/lib/language/text-logic";

// The block as the engine plays it, without the text it also carries for
// the GM to read (the printed block, the trait lines): those are the row's
// own words, already in the pack beside the reading.
export type MonsterMechanics = Omit<EnemyStats, "printed" | "traits" | "fullTraits">;

export function monsterMechanics(stats: EnemyStats): MonsterMechanics {
  const { printed: _printed, traits: _traits, fullTraits: _fullTraits, ...mechanics } = stats;
  return mechanics;
}

type RawEntry = { name?: unknown; desc?: unknown };

const SECTIONS = ["actions", "bonus_actions", "reactions", "legendary_actions", "special_abilities"] as const;
// Numbers an engine would run: a save's DC, or dice of damage or healing.
const NUMBERS = /\bDC\s*\d{1,2}\b|\d+\s*\(\d+d\d+(?:\s*[+-]\s*\d+)?\)|\b\d+d\d+\b/;
// Entries some reader owns without naming them as an ability.
const OWNED = /^(?:multiattack|legendary resistance|spellcasting|innate spellcasting|regeneration)\b/i;

// The name an ability is keyed by, without its tags ("Fire Breath
// (Recharge 5-6)" is "fire breath").
const bare = (name: string) => textKey(name.replace(/\([^)]*\)?/g, " "));

// Every entry with numbers in its text that is neither an attack, nor an
// ability the engine runs, nor a part some reader owns (Multiattack,
// Spellcasting, Regeneration, Legendary Resistance): the GM plays it from
// the printed line.
export function monsterUnread(data: Record<string, unknown>, stats: EnemyStats): string[] {
  const taken = new Set<string>([
    ...stats.attacks.map((attack) => bare(attack.name)),
    ...(stats.legendaryAttacks ?? []).map((attack) => bare(attack.name)),
    ...(stats.specials ?? []).flatMap((ability) => [bare(ability.name), ...(ability.group ? [bare(ability.group)] : [])]),
  ]);
  const unread: string[] = [];
  for (const section of SECTIONS) {
    const entries = Array.isArray(data[section]) ? (data[section] as RawEntry[]) : [];
    for (const entry of entries) {
      const name = String(entry?.name ?? "").trim();
      const desc = String(entry?.desc ?? "");
      // A spell printed as an action (Level Up's "Hold Monster (5th-Level;
      // V, S, Concentration)") is the block's spellcasting.
      if (!name || OWNED.test(name) || !NUMBERS.test(desc) || taken.has(bare(name)) || spellOfAction(name)) {
        continue;
      }
      if (section !== "special_abilities" && parseAttack(entry as Record<string, unknown>)) {
        continue;
      }
      // A trait whose dice every attack already carries (Black Flag's
      // Flaming Weapons, "an extra 3d8 fire damage") was read into them.
      const dice = desc.match(/\d+d\d+/g) ?? [];
      if (dice.length && dice.every((die) => stats.attacks.some((attack) => String(attack.damage ?? "").includes(die)))) {
        continue;
      }
      unread.push(name);
    }
  }
  return unread;
}

export function readMonster(row: ReadingRow): EntryReading {
  const data = { ...row.data, slug: row.data.slug ?? row.slug, document__slug: row.data.document__slug ?? row.documentSlug };
  const stats = parseMonster(data, Number(row.cr) || 0);
  // Armor, hit points and scores are read from every block that prints
  // them, so a block with no attacks (a frog, a shrieker) is still read; only
  // one with no hit points to play is missing.
  return reading({
    handWritten: null,
    parsed: stats.maxHp > 0 ? monsterMechanics(stats) : null,
    unread: monsterUnread(data, stats),
    // A block corrected by hand was held up against its book.
    checked: hasPackCorrection(row.documentSlug, row.slug) || readingChecked("monster", row),
  });
}
