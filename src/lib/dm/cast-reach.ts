// Whether a spell reaches its target on a mapped fight: its range, and a
// clear line to the target (a creature behind total cover cannot be
// targeted, SRD 5.1 Cover and Spellcasting, "A Clear Path to the Target").
//
// Reads the live board through attack-spatial.ts. With no map, or a token
// off it, there is nothing to measure and the answer is "it reaches"
// (theatre of the mind, docs/rules-coverage.md). A spell whose range is
// Self spreads from the caster (a cone, a line, an aura): it reaches as far
// as its area when the range line prints one, and never through a wall.

import { spellRangeFactor } from "@/lib/srd/feat-combat";
import type { Campaign } from "@/lib/db/campaigns";
import { spellDamageFor, spellFactsFor } from "@/lib/content";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { globeProblem } from "@/lib/dm/zone-rules";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";

const FEET_PER_TILE = 5;

// The farthest a spell reaches, in tiles, or null when range is not a
// distance the board can hold it to.
export function spellReachTiles(facts: SpellFacts | null): number | null {
  if (!facts) {
    return null;
  }
  if (facts.range.kind === "touch") {
    return 1;
  }
  if (facts.range.kind === "feet") {
    return Math.max(1, Math.floor(facts.range.feet / FEET_PER_TILE));
  }
  return null;
}

export function spellReachProblem(input: {
  encounterId: string;
  casterId: string;
  casterName: string;
  targetId: string;
  targetName: string;
  facts: SpellFacts | null;
}): string | null {
  const { facts } = input;
  if (!facts) {
    return null;
  }
  const apart = tilesBetween(input.encounterId, input.casterId, input.targetId);
  if (apart === null || input.casterId === input.targetId) {
    return null;
  }
  const reach =
    facts.range.kind === "self"
      ? facts.range.areaFeet
        ? Math.max(1, Math.floor(facts.range.areaFeet / FEET_PER_TILE))
        : null
      : spellReachTiles(facts);
  if (reach !== null && apart > reach) {
    return facts.range.kind === "touch"
      ? `${facts.name} is a touch spell and ${input.targetName} is ${apart * FEET_PER_TILE} ft from ${input.casterName}. They must move next to them first. No slot was spent.`
      : `${input.targetName} is ${apart * FEET_PER_TILE} ft from ${input.casterName}, beyond ${facts.name}'s reach of ${facts.range.kind === "feet" ? facts.range.feet : reach * FEET_PER_TILE} ft. They must move closer or pick another target. No slot was spent.`;
  }
  if (apart > 1 && wallBetween(input.encounterId, input.casterId, input.targetId)) {
    return `${input.targetName} is behind total cover from ${input.casterName}: a spell needs a clear path to its target. They must move to a clear line first or pick another target. No slot was spent.`;
  }
  // A Globe of Invulnerability around the target (src/lib/dm/zone-rules.ts).
  return globeProblem(input.encounterId, input.casterId, input.targetId, input.targetName, facts.name, facts.level);
}

// An attack-roll spell's profile held to the spell: its own range in feet
// (Fire Bolt 120, Chill Touch 120, Guiding Bolt 120, Ray of Frost 60) and no
// long range beyond it, since a spell has none (SRD 5.1, Range). A touch
// spell keeps ODM's reach (attack-logic.ts spellAttackProfile). Cast from a
// higher slot, the dice are the slot's.
export function spellAttackReach(
  campaign: Campaign,
  sheet: Pick<CharacterSheet, "level"> & Partial<Pick<CharacterSheet, "feats" | "features">>,
  spell: string,
  profile: AttackProfile,
  slotLevel: number | null,
): AttackProfile {
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  // Spell Sniper doubles an attack-roll spell's range (feat-combat.ts).
  const factor = spellRangeFactor(sheet);
  const rangeTiles =
    facts?.range.kind === "feet" ? Math.max(1, Math.floor((facts.range.feet * factor) / FEET_PER_TILE)) : profile.rangeTiles * factor;
  let damageExpression = profile.damageExpression;
  if (facts && slotLevel && slotLevel > facts.level) {
    const base = spellDamageFor({ spell, userIds: authors, casterLevel: sheet.level, slotLevel: facts.level })?.dice;
    const upcast = spellDamageFor({ spell, userIds: authors, casterLevel: sheet.level, slotLevel })?.dice;
    if (base && upcast && damageExpression.startsWith(base)) {
      damageExpression = `${upcast}${damageExpression.slice(base.length)}`;
    }
  }
  return { ...profile, rangeTiles, longRangeTiles: rangeTiles, damageExpression };
}
