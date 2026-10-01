// The odds of one enemy swing: every source of advantage and disadvantage
// on the monster's attack roll (conditions on both sides, light, weather,
// the Flanking variant, Pack Tactics, Sunlight Sensitivity, a spell left on
// it, the target's own features) folded into one roll mode, with the notes
// that explain it. Split from enemy-attack.ts, which rolls each swing of the
// routine with what this returns. Nothing is spent or stored here.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { Advantage } from "@/lib/dice";
import { enemyFlanks, enemyShootsInMelee } from "@/lib/dm/attack-spatial";
import { attackSight, characterSenses, enemySenses, lightOnAttack } from "@/lib/dm/attack-light";
import { authoredIncomingAttack } from "@/lib/dm/authored-hooks";
import { normalizeClock } from "@/lib/dm/calendar";
import { attackContext, isIncapacitated, mergeAdvantage } from "@/lib/dm/condition-logic";
import { enemyAllyNear } from "@/lib/dm/enemy-approach";
import { enemyExhaustion, hasTrait } from "@/lib/dm/monster-abilities";
import { withLiveDodge } from "@/lib/dm/opportunity";
import { claimedAdvantage } from "@/lib/dm/pc-attack-options";
import { CHILL_TOUCH_DREAD } from "@/lib/dm/spell-attack-riders";
import { cursedAgainst } from "@/lib/dm/spell-retort";
import { inDirectSunlight } from "@/lib/dm/sunlight";
import type { underwaterSwing } from "@/lib/dm/underwater";
import { conditionsOf } from "@/lib/dm/vitals-logic";
import type { ConditionRollRiders } from "@/lib/srd/condition-effects";
import { weatherRangedRider } from "@/lib/srd/weather";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A feature on the sheet by name (a Hunter's pick is kept as its own feature).
export function hasFeatureNamed(sheet: CharacterSheet, name: RegExp): boolean {
  return (sheet.features ?? []).some((feature) => name.test(feature.name.trim()));
}

export function enemySwingOdds(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounterId: string;
  // The creature as it stands after the walk in (its live conditions).
  standing: EncounterEnemy;
  target: CharacterSheet;
  requested: { advantage?: Advantage; advantageReason?: string };
  ranged: boolean;
  longRange: boolean;
  // Tiles between the two, null off the map.
  distance: number | null;
  // Both tokens are on an outdoor board, where a gale reaches the shot.
  outdoorsOnMap: boolean;
  underwater: ReturnType<typeof underwaterSwing> | null;
  riders: ConditionRollRiders;
  // Multiattack Defense's +4 is already up.
  defended: number;
}): {
  advantage: Advantage;
  notes: string[];
  autoCrit: boolean;
  authored: ReturnType<typeof authoredIncomingAttack>;
} {
  const { campaign, turn, encounterId, standing, target, requested, ranged, longRange, distance, underwater, riders } = input;
  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  const conditionContext = attackContext({
    attackerConditions: standing.conditions,
    attackerType: standing.stats.type,
    // Dodge is lost with the dodger's speed, and a character at 0 hit
    // points is unconscious and prone whatever wrote the 0.
    targetConditions: withLiveDodge(conditionsOf(getSheetById(target.id) ?? target)),
    melee: !ranged,
    adjacent: distance === null ? !ranged : distance <= 1,
    // The AI names a circumstance the engine does not decide (pc-attack-options.ts).
    requested: claimedAdvantage({ requested: requested.advantage, reason: requested.advantageReason, byAi: turn.actor === "ai" }).requested,
  });
  // A gale over an outdoor board: disadvantage on ranged attacks past 30
  // ft, for the monsters exactly as for the party.
  const gale = input.outdoorsOnMap
    ? weatherRangedRider(normalizeClock(campaign.clock).weather, ranged, distance ?? 0)
    : { disadvantage: false, note: null };
  // A shot with a character at the shooter's elbow, and the Flanking
  // variant, for the monsters exactly as for the party.
  const crowded = ranged && enemyShootsInMelee(encounterId, standing.id, standing.conditions);
  const flanking =
    campaign.gameSettings.variantRules.flanking && !ranged && enemyFlanks(encounterId, standing.id, target.id);
  // Pack Tactics: an ally of the creature, up and able, beside the target.
  const pack = hasTrait(standing.stats, "packTactics") && enemyAllyNear(encounterId, standing.id, target.id);
  // Exhaustion 3 or worse: disadvantage on its attack rolls.
  const worn = enemyExhaustion(standing.conditions) >= 3;
  // Sunlight Sensitivity: disadvantage in direct sunlight (sunlight.ts).
  const sunlit = hasTrait(standing.stats, "sunlightSensitivity") && inDirectSunlight(campaign.id);
  // Light on a mapped fight: who can see whom (src/lib/dm/attack-light.ts).
  const light = lightOnAttack(
    attackSight({
      campaignId: campaign.id,
      encounterId,
      attacker: { refId: standing.id, senses: enemySenses(standing) },
      target: { refId: target.id, senses: characterSenses(target) },
    }),
    { attacker: standing.displayName, target: target.name },
  );
  // Chill Touch: an undead the caster struck attacks the caster at
  // disadvantage until the end of the caster's next turn (CHILL_TOUCH_DREAD,
  // src/lib/dm/spell-attack-riders.ts; an older row carries only the spell).
  const chillMeta = standing.conditionMeta as Record<string, { source?: string }>;
  const chilled =
    /undead/i.test(standing.stats.type ?? "") &&
    [CHILL_TOUCH_DREAD, "chill touch"].some(
      (name) => standing.conditions.includes(name) && chillMeta[name]?.source === target.id,
    );
  // Elusive (rogue 18): no attack roll against them has advantage while
  // they are not incapacitated.
  const liveTarget = getSheetById(target.id) ?? target;
  const elusive = hasFeatureNamed(liveTarget, /^elusive$/i) && !isIncapacitated(liveTarget.conditions);
  // Authored subclass features (Among the Dead, Fungal Body, a guardian's mark): authored-hooks.ts.
  const authored = authoredIncomingAttack({ campaignId: campaign.id, encounterId, attacker: standing, target: liveTarget });
  const sources: Advantage[] = [
    conditionContext.advantage,
    ...light.sources,
    ...(gale.disadvantage ? ["disadvantage" as const] : []),
    ...(crowded ? ["disadvantage" as const] : []),
    ...(longRange ? ["disadvantage" as const] : []),
    ...(sunlit ? ["disadvantage" as const] : []),
    ...(worn ? ["disadvantage" as const] : []),
    ...(flanking ? ["advantage" as const] : []),
    ...(pack ? ["advantage" as const] : []),
    ...(chilled ? ["disadvantage" as const] : []),
    ...(underwater?.disadvantage ? ["disadvantage" as const] : []),
    // Bestow Curse on its attacks against the caster (spell-retort.ts).
    ...(cursedAgainst(standing, target.id) ? ["disadvantage" as const] : []),
    ...riders.advantageSources,
    ...authored.sources,
  ];
  const advantage: Advantage = mergeAdvantage(elusive ? sources.filter((source) => source !== "advantage") : sources);
  const notes = [
    ...conditionContext.notes,
    ...light.notes,
    ...(gale.note ? [gale.note] : []),
    ...(crowded ? ["a hostile creature is within 5 feet: disadvantage on ranged attacks"] : []),
    ...(longRange ? ["past its normal range: disadvantage"] : []),
    ...(sunlit ? ["Sunlight Sensitivity: disadvantage in direct sunlight"] : []),
    ...(worn ? [`exhaustion ${enemyExhaustion(standing.conditions)}: disadvantage on attack rolls`] : []),
    ...(flanking ? ["flanking: advantage"] : []),
    ...(pack ? ["Pack Tactics: advantage"] : []),
    ...(chilled ? ["Chill Touch: an undead attacks its caster at disadvantage"] : []),
    ...(underwater?.note ? [underwater.note] : []),
    ...(elusive && sources.includes("advantage") ? [`Elusive: no attack roll against ${target.name} has advantage`] : []),
    ...(input.defended ? [`Multiattack Defense: +4 AC against ${standing.displayName}'s later attacks this turn`] : []),
    ...authored.notes,
  ];
  return { advantage, notes, autoCrit: conditionContext.autoCrit, authored };
}
