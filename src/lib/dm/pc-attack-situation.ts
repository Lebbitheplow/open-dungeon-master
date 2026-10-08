// Where attacker and target stand and what that does to a player's attack
// roll: the Armor Class to beat with cover, whether the attack is made at
// range, and every source of advantage and disadvantage with the note that
// explains it. Split from pc-attack.ts, which decides the attack. Read-only:
// the board, the conditions, the effects and the settings are looked at,
// nothing is written and nothing is refused.

import { liftsSmallHeavyPenalty } from "@/lib/srd/feat-combat";
import { shootsFreelyInMelee } from "@/lib/srd/feat-combat";
import type { Campaign } from "@/lib/db/campaigns";
import { inDirectSunlight } from "@/lib/dm/sunlight";
import { hasSunlightSensitivity } from "@/lib/srd/trait-rules";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { Advantage } from "@/lib/dice";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { attackSight, characterSenses, enemySenses, lightOnAttack } from "@/lib/dm/attack-light";
import {
  characterFlanks,
  characterShootsInMelee,
  creatureCover,
  tilesBetween,
} from "@/lib/dm/attack-spatial";
import { normalizeClock } from "@/lib/dm/calendar";
import { attackContext, exhaustionRollState, mergeAdvantage } from "@/lib/dm/condition-logic";
import type { effectOutcome } from "@/lib/dm/effect-tools";
import { pcAttackSpatials } from "@/lib/dm/map-tools";
import type { FeatureRider } from "@/lib/dm/pc-attack-damage";
import type { ManeuverPick } from "@/lib/dm/pc-attack-plan";
import type { BuiltAttack } from "@/lib/dm/pc-attack-profile";
import { sizeForRace } from "@/lib/srd";
import { wearsUntrainedArmor } from "@/lib/srd/armor";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { weatherRangedRider } from "@/lib/srd/weather";
import { isImmersed, underwaterSwing } from "@/lib/dm/underwater";
import { swimsFrom } from "@/lib/battlemap/types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

import { heldHelp } from "@/lib/dm/help-logic";
import { authoredAttackSituation } from "@/lib/dm/authored-hooks";
import { hasFeralSenses, seenTargetConditions } from "@/lib/dm/attack-features";

// An unspent Bardic Inspiration die: the size rides in the condition name,
// "bardic inspiration (d8)", as use_resource writes it.
function heldInspiration(conditions: string[]): { condition: string; die: string } | null {
  for (const condition of conditions) {
    const match = /^bardic inspiration \((d\d{1,2})\)$/i.exec(condition.trim());
    if (match) {
      return { condition, die: match[1].toLowerCase() };
    }
  }
  return null;
}

export type AttackGeometry = ReturnType<typeof attackGeometry>;

export function attackGeometry(
  campaignId: string,
  encounterId: string,
  sheetId: string,
  enemy: EncounterEnemy,
  profile: AttackProfile,
) {
  // Terrain cover raises the AC to beat; a shot past normal range is taken
  // at disadvantage.
  const spatials = pcAttackSpatials(encounterId, sheetId, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    thrown: profile.thrown,
  });
  // A creature in the line gives half cover; the better cover counts.
  const screen = spatials.cover < 5 ? creatureCover(encounterId, sheetId, enemy.id) : null;
  const cover: 0 | 2 | 5 = screen && spatials.cover < 2 ? 2 : spatials.cover;
  const effectiveAc = enemyAcWithEffects(campaignId, enemy) + cover;
  // How far apart the two stand, when the board knows. A thrown weapon is a
  // ranged attack once it leaves the hand, a melee one inside its reach.
  const apart = tilesBetween(encounterId, sheetId, enemy.id);
  const atRange =
    profile.ranged || (profile.thrown && apart !== null && apart > profile.reachTiles);
  const withinFiveFeet = apart === null ? !profile.ranged : apart <= 1;
  return { spatials, cover, screen, effectiveAc, apart, atRange, withinFiveFeet };
}

type EffectOutcome = ReturnType<typeof effectOutcome>;

// Every note and advantage source for the roll, in the order the table
// reads them.
export function attackSituation(input: {
  campaign: Campaign;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  requested: Advantage | undefined;
  geometry: AttackGeometry;
  profile: AttackProfile;
  kind: BuiltAttack["kind"];
  special: BuiltAttack["special"];
  scalingNote: string | null;
  riders: CombatRiders;
  rageBonus: number;
  attackEffect: EffectOutcome;
  damageEffect: EffectOutcome;
  onHitNotes: string[];
  featureRiders: FeatureRider[];
  maneuver: ManeuverPick | null;
  // Reckless Attack's advantage on this swing (pc-attack-options.ts).
  recklessAdvantage?: boolean;
  // What became of the caller's advantage claim, for the notes.
  claimNote?: string | null;
  // Inspiration spent on this roll.
  inspired?: boolean;
}) {
  const { campaign, encounter, sheet, enemy, geometry, profile, kind, maneuver } = input;
  const { spatials, apart, atRange } = geometry;

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  // Feral Senses: a creature the ranger cannot see costs the roll nothing
  // (src/lib/dm/attack-features.ts).
  const feral = hasFeralSenses(sheet);
  const conditionContext = attackContext({
    attackerConditions: sheet.conditions,
    targetConditions: seenTargetConditions(sheet, enemy.conditions),
    melee: !atRange,
    adjacent: geometry.withinFiveFeet,
    requested: input.requested ?? "none",
  });
  // Light on a mapped fight: who can see whom (src/lib/dm/attack-light.ts).
  const sight = attackSight({
    campaignId: campaign.id,
    encounterId: encounter.id,
    attacker: { refId: sheet.id, senses: characterSenses(sheet) },
    target: { refId: enemy.id, senses: enemySenses(enemy) },
  });
  const light = lightOnAttack(sight && feral ? { ...sight, attackerSees: true } : sight, {
    attacker: sheet.name,
    target: enemy.displayName,
  });
  if (feral && ((sight !== null && !sight.attackerSees) || enemy.conditions.some((entry) => /^(invisible|hidden)$/i.test(entry.trim())))) {
    conditionContext.notes.push("Feral Senses: not seeing the target costs no disadvantage");
  }
  conditionContext.notes.push(...light.notes);
  const exhaustion = exhaustionRollState(sheet.exhaustion ?? 0, "attack");
  if (exhaustion.note) {
    conditionContext.notes.push(exhaustion.note);
  }
  if (input.rageBonus) {
    conditionContext.notes.push(`raging: +${input.rageBonus} melee damage`);
  }
  for (const note of profile.riderNotes) {
    conditionContext.notes.push(note);
  }
  if (input.scalingNote) {
    conditionContext.notes.push(input.scalingNote);
  }
  if (input.attackEffect.sources.length) {
    conditionContext.notes.push(`on attack rolls: ${input.attackEffect.sources.join("; ")}`);
  }
  if (input.damageEffect.sources.length) {
    conditionContext.notes.push(`on damage rolls: ${input.damageEffect.sources.join("; ")}`);
  }
  if (geometry.cover) {
    conditionContext.notes.push(
      `${enemy.displayName} has ${geometry.cover === 2 ? "half" : "three-quarters"} cover${
        geometry.screen && geometry.cover === 2 ? ` behind ${geometry.screen}` : ""
      }: +${geometry.cover} AC`,
    );
  }
  if (spatials.longRange) {
    conditionContext.notes.push("beyond normal range: disadvantage");
  }
  // A ranged attack with a hostile creature at the attacker's elbow.
  // Crossbow Expert and Gunner shoot freely with a foe at their elbow.
  const crowded = atRange && !shootsFreelyInMelee(sheet) && characterShootsInMelee(encounter.id, sheet.id, sheet.conditions);
  if (crowded) {
    conditionContext.notes.push("a hostile creature is within 5 feet: disadvantage on ranged attacks");
  }
  // The lance is unwieldy up close.
  const lanceClose = input.special === "lance" && apart !== null && apart <= 1;
  if (lanceClose) {
    conditionContext.notes.push("a lance against a target within 5 feet: disadvantage");
  }
  // Variant: Flanking. An ally on the far side of the target.
  const flanking =
    campaign.gameSettings.variantRules.flanking &&
    !atRange &&
    kind !== "spell" &&
    characterFlanks(encounter.id, sheet.id, enemy.id);
  if (flanking) {
    conditionContext.notes.push("flanking: advantage");
  }
  // A held Help: advantage on this attack, which spends it.
  // Only a Help given against this enemy (src/lib/dm/help-logic.ts).
  const helped = heldHelp(sheet, { enemyId: enemy.id });
  if (helped) {
    conditionContext.notes.push("spends the Help their ally gave them: advantage");
  }
  if (input.claimNote) {
    conditionContext.notes.push(input.claimNote);
  }
  if (input.recklessAdvantage) {
    conditionContext.notes.push("attacking recklessly: advantage");
  }
  if (input.inspired) {
    conditionContext.notes.push("spends their Inspiration: advantage");
  }
  // The Grappler feat: advantage against the creature its holder grapples.
  const grappling =
    sheet.feats.some((feat) => feat.trim().toLowerCase() === "grappler") &&
    enemy.conditions.some(
      (entry) =>
        entry.trim().toLowerCase() === "grappled" &&
        (enemy.conditionMeta as Record<string, { source?: string } | undefined>)[entry]?.source === sheet.id,
    );
  // Authored subclass features (Assassinate, Avenging Angel, the wolf totem): authored-hooks.ts.
  const authored = authoredAttackSituation({ campaignId: campaign.id, encounter, sheet, enemy, melee: !atRange });
  conditionContext.notes.push(...authored.notes);
  conditionContext.autoCrit = conditionContext.autoCrit || Boolean(authored.autoCrit);
  if (grappling) {
    conditionContext.notes.push(`Grappler: advantage against the creature ${sheet.name} grapples`);
  }
  if (maneuver) {
    conditionContext.notes.push(
      `${maneuver.name}: +1${maneuver.die} ${
        maneuver.precision ? "to the attack roll, the Superiority Die spent on the roll" : "damage on a hit, which spends the Superiority Die"
      }${maneuver.rider ? `, ${maneuver.rider.save.toUpperCase()} save rider on a hit` : ""}`,
    );
  }

  // Effect conditions on the attacker's own roll: Bless's +1d4, Bane's
  // -1d4, True Strike's one-shot advantage.
  const attackRiders = conditionRollRiders(sheet.conditions, "attack");
  // A held Bardic Inspiration die rides the attack roll and is spent by it,
  // as it is by a check or a save (src/lib/dm/rolls.ts).
  const inspiration = heldInspiration(sheet.conditions);
  if (inspiration) {
    attackRiders.diceSuffix += `+1${inspiration.die}`;
    attackRiders.notes.push(`spends their Bardic Inspiration die: +1${inspiration.die} to the attack roll`);
    attackRiders.spent.push(inspiration.condition);
  }
  conditionContext.notes.push(...attackRiders.notes, ...input.onHitNotes);
  for (const rider of input.featureRiders) {
    conditionContext.notes.push(
      `${rider.feature}: +${rider.dice}${rider.type ? ` ${rider.type}` : ""} damage`,
    );
  }
  if (input.riders.magicalAttacks && kind !== "spell") {
    conditionContext.notes.push("their attacks count as magical for overcoming resistance");
  }
  // SRD heavy property: Small creatures swing oversized weapons at
  // disadvantage.
  // Giant Foe lifts the Small character's heavy-weapon disadvantage (feat-combat.ts).
  const smallWithHeavy = profile.heavy && sizeForRace(sheet.race) === "Small" && !liftsSmallHeavyPenalty(sheet);
  // Sunlight Sensitivity: in direct sunlight, disadvantage (sunlight.ts).
  const sunlit = hasSunlightSensitivity(sheet) && inDirectSunlight(campaign.id);
  if (sunlit) {
    conditionContext.notes.push(`${sheet.name} is in direct sunlight (Sunlight Sensitivity): disadvantage`);
  }
  if (smallWithHeavy) {
    conditionContext.notes.push(
      `${profile.weapon} is a heavy weapon and ${sheet.name} is Small: disadvantage`,
    );
  }
  // SRD armor: worn without the training for it, every attack that uses
  // Strength or Dexterity is made at disadvantage. A spell attack uses the
  // casting ability and is the cast guard's business.
  const armorUntrained = kind !== "spell" && wearsUntrainedArmor(sheet);
  if (armorUntrained) {
    conditionContext.notes.push(
      `${sheet.name} wears armor they are not trained in: disadvantage`,
    );
  }
  // Variant: Encumbrance. A heavily loaded character swings at disadvantage
  // like any other physical roll.
  const load = campaign.gameSettings.variantRules.encumbrance
    ? encumbranceFor({
        strength: sheet.abilities.str,
        equipment: sheet.equipment ?? [],
        coins: sheet.gold ?? 0,
      })
    : null;
  if (load?.disadvantage && load.note) {
    conditionContext.notes.push(load.note);
  }
  // A gale over an outdoor board: disadvantage on ranged attacks past 30 ft.
  const gale = spatials.outdoors
    ? weatherRangedRider(
        normalizeClock(campaign.clock).weather,
        profile.ranged || profile.thrown,
        spatials.distanceTiles,
      )
    : { disadvantage: false, note: null };
  if (gale.note) {
    conditionContext.notes.push(gale.note);
  }
  // Under the water: weapons not made for it (src/lib/dm/underwater.ts).
  const underwater = kind !== "spell" && isImmersed(campaign.id, sheet.id)
    ? underwaterSwing({ weapon: profile.weapon, melee: !atRange, swims: swimsFrom(undefined, sheet.features), beyondNormal: spatials.longRange })
    : null;
  if (underwater?.note) {
    conditionContext.notes.push(underwater.note);
  }
  const advantage: Advantage = mergeAdvantage([
    conditionContext.advantage,
    exhaustion.advantage,
    ...(load?.disadvantage ? ["disadvantage" as const] : []),
    ...attackRiders.advantageSources,
    ...(input.attackEffect.advantage ? ["advantage" as const] : []),
    ...(input.attackEffect.disadvantage ? ["disadvantage" as const] : []),
    ...(helped ? ["advantage" as const] : []),
    ...(flanking ? ["advantage" as const] : []),
    ...(input.recklessAdvantage ? ["advantage" as const] : []),
    ...(input.inspired ? ["advantage" as const] : []),
    ...light.sources,
    ...(grappling ? ["advantage" as const] : []),
    ...authored.sources,
    ...(spatials.longRange ? ["disadvantage" as const] : []),
    ...(crowded ? ["disadvantage" as const] : []),
    ...(lanceClose ? ["disadvantage" as const] : []),
    ...(smallWithHeavy ? ["disadvantage" as const] : []),
    ...(sunlit ? ["disadvantage" as const] : []),
    ...(armorUntrained ? ["disadvantage" as const] : []),
    ...(gale.disadvantage ? ["disadvantage" as const] : []),
    ...(underwater?.disadvantage ? ["disadvantage" as const] : []),
  ]);
  return { context: conditionContext, advantage, helped, attackRiders };
}
