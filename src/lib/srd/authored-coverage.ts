// How the authored subclass layer stands: every feature in
// src/lib/srd/subclasses.json sorted into typed (an engine applies it),
// counter (a limited-use pool the sheet tracks), narrated (roleplay, or a
// mechanic another engine must hold first, with the reason written down),
// plain (no mechanical wording), or uncovered (mechanical wording and none of
// the above). The coverage guard (scripts/test-feature-coverage.mjs) holds
// `uncovered` at empty, so a new authored feature with a number in its text
// cannot land without a hook or a written reason.
//
// Split from authored-effects.ts, which feature-effects.ts imports: this
// module reads feature-effects and class-resources back.

import subclassesJson from "@/lib/srd/subclasses.json";
import { AUTHORED_TABLE, authoredRows } from "@/lib/srd/authored-effects";
import { populateResources } from "@/lib/srd/class-resources";
import { effectsFor } from "@/lib/srd/feature-effects";

// The words that make a rules line mechanical: the audit's own pattern
// (/tmp/odm-enf2/authored.mjs), so the counts compare with its 166.
export const MECHANICAL =
  /advantage|disadvantage|\+\d|resistan|immun|\d+d\d+|bonus action|reaction|temporary hit points|regain|speed|saving throw|AC\b|armor class|critical|extra attack|attack twice/i;

type Raw = { classes: Record<string, Array<{ name: string; levels: Record<string, Array<{ n: string; d: string }>> }>> };

export type AuthoredCoverage = {
  total: number;
  typed: string[];
  counter: string[];
  narrated: Array<{ key: string; reason: string }>;
  plain: string[];
  uncovered: string[];
  // Table keys no feature in subclasses.json answers to.
  stale: string[];
};

export function authoredCoverage(): AuthoredCoverage {
  const out: AuthoredCoverage = { total: 0, typed: [], counter: [], narrated: [], plain: [], uncovered: [], stale: [] };
  const seen = new Set<string>();
  const mods = { str: 2, dex: 2, con: 2, int: 3, wis: 3, cha: 3 };
  for (const [classId, entries] of Object.entries((subclassesJson as Raw).classes)) {
    for (const entry of entries) {
      for (const [levelKey, features] of Object.entries(entry.levels)) {
        for (const feature of features) {
          out.total += 1;
          const key = `${classId}::${feature.n}`;
          seen.add(key.toLowerCase());
          const authored = AUTHORED_TABLE[key];
          const typedHere =
            Boolean(authored?.effects?.length || authored?.spends?.length || authored?.reactions?.length) ||
            effectsFor({ class: classId, features: [{ name: feature.n, classId }] }).length > 0;
          if (typedHere) {
            out.typed.push(key);
            continue;
          }
          const counted =
            Boolean(authored?.counter) ||
            Object.keys(populateResources([{ name: feature.n, classId }], Math.max(1, Number(levelKey)), mods, {}, undefined)).length > 0;
          if (counted) {
            out.counter.push(key);
            continue;
          }
          if (authored?.narrated) {
            out.narrated.push({ key, reason: authored.narrated });
            continue;
          }
          if (MECHANICAL.test(feature.d)) {
            out.uncovered.push(key);
          } else {
            out.plain.push(key);
          }
        }
      }
    }
  }
  out.stale = Object.keys(AUTHORED_TABLE).filter((key) => !seen.has(key.toLowerCase()));
  return out;
}

// Every effect kind the tables use, with the engine file that reads it and
// the call it makes there. scripts/test-enforce-authored.mjs reads each file
// for its call, so an entry cannot outlive the code that enforces it.
export const AUTHORED_READERS: Record<string, { file: string; call: string }> = {
  resist: { file: "src/lib/dm/pc-defenses.ts", call: "authoredResistances(" },
  immune_damage: { file: "src/lib/srd/trait-rules.ts", call: "authoredDamageImmunities(" },
  immune_condition: { file: "src/lib/srd/trait-rules.ts", call: "authoredConditionImmunities(" },
  save_adv: { file: "src/lib/srd/trait-rules.ts", call: "authoredSaveAdvantages(" },
  save_prof: { file: "src/lib/srd/trait-rules.ts", call: "authoredSaveProficiencies(" },
  save_bonus: { file: "src/lib/srd/index.ts", call: "authoredSaveModifier(" },
  save_swap: { file: "src/lib/srd/index.ts", call: "authoredSaveModifier(" },
  ac: { file: "src/lib/srd/index.ts", call: "authoredAcBonus(" },
  speed: { file: "src/lib/srd/feature-effects.ts", call: "authoredFeatureDefs(" },
  move: { file: "src/lib/srd/index.ts", call: "authoredSpeeds(" },
  init_adv: { file: "src/lib/srd/trait-rules.ts", call: "authoredInitiativeAdvantage(" },
  init_ability: { file: "src/lib/srd/feature-effects.ts", call: "authoredFeatureDefs(" },
  check_adv: { file: "src/lib/dm/roll-feature-riders.ts", call: "authoredRollRiders(" },
  crit_immune: { file: "src/lib/dm/enemy-swing-odds.ts", call: "authoredIncomingAttack(" },
  ignore_resist: { file: "src/lib/dm/enemy-damage.ts", call: "authoredIgnoresResistance(" },
  attacked_disadv: { file: "src/lib/dm/enemy-swing-odds.ts", call: "authoredIncomingAttack(" },
  attack_adv: { file: "src/lib/dm/pc-attack-situation.ts", call: "authoredAttackSituation(" },
  auto_crit: { file: "src/lib/dm/pc-attack-situation.ts", call: "authoredAttackSituation(" },
  init_refill: { file: "src/lib/srd/resource-refills.ts", call: "authoredInitiativeRefills(" },
  kill_temp_hp: { file: "src/lib/dm/pc-attack-resolve.ts", call: "authoredOnHit(" },
  death_heal: { file: "src/lib/dm/pc-attack-resolve.ts", call: "authoredOnHit(" },
  turn_heal: { file: "src/lib/dm/condition-tick.ts", call: "authoredTurn" },
  rest_temp_hp: { file: "src/lib/dm/rest-tools.ts", call: "authoredRestTempHp(" },
  rider: { file: "src/lib/srd/feature-effects.ts", call: "authoredFeatureDefs(" },
  mark: { file: "src/lib/dm/pc-attack-resolve.ts", call: "authoredOnHit(" },
  guard_aura: { file: "src/lib/dm/enemy-swing-odds.ts", call: "authoredIncomingAttack(" },
  pack_adv: { file: "src/lib/dm/pc-attack-situation.ts", call: "authoredAttackSituation(" },
  bonus_route: { file: "src/lib/dm/bonus-routes.ts", call: "authoredBonusRoute(" },
  bonus_attack: { file: "src/lib/dm/pc-attack-options.ts", call: "authoredBonusAttackProblem(" },
  enemy_save: { file: "src/lib/dm/forced-save.ts", call: "authoredEnemySave(" },
  aura_resist: { file: "src/lib/dm/pc-damage.ts", call: "authoredAuraResistances(" },
  retaliate: { file: "src/lib/dm/enemy-attack.ts", call: "authoredAfterHit(" },
  enemy_turn_damage: { file: "src/lib/dm/condition-tick.ts", call: "authoredTurn" },
  flurry: { file: "src/lib/dm/bonus-actions.ts", call: "authoredFlurryStrikes(" },
  sneak_duel: { file: "src/lib/dm/pc-attack-damage.ts", call: "authoredSneakEdge(" },
  heal_max: { file: "src/lib/dm/heal-spell.ts", call: "authoredHealMax(" },
  // The final round's hooks (src/lib/srd/authored-effects-more.ts).
  natural_weapon: { file: "src/lib/dm/pc-attack-profile.ts", call: "authoredNaturalWeapon(" },
  reach: { file: "src/lib/dm/pc-attack-profile.ts", call: "authoredReachBonus(" },
  sneak_bonus: { file: "src/lib/dm/pc-attack-damage.ts", call: "authoredSneakBonus(" },
  save_die_vs: { file: "src/lib/dm/forced-save.ts", call: "authoredSaveDieVs(" },
  spell_rider: { file: "src/lib/srd/spell-damage-riders.ts", call: "authoredSpellDice(" },
  concentration_guard: { file: "src/lib/dm/concentration.ts", call: "authoredConcentrationGuard(" },
  twin_spell: { file: "src/lib/dm/authored-reaper.ts", call: "authoredTwinSpell(" },
  rapid_strike: { file: "src/lib/dm/pc-attack-plan.ts", call: "rapidStrike(" },
  oa_each_turn: { file: "src/lib/dm/opportunity.ts", call: "opportunityReactionKey(" },
  stand_cost: { file: "src/lib/battlemap/view.ts", call: "standUpTiles(" },
  mote: { file: "src/lib/dm/resource-tools.ts", call: "holdsMote(" },
  swarm_prone: { file: "src/lib/dm/authored-spend-more.ts", call: "swarmKnocksProne(" },
  // The last round's (src/lib/dm/arcane-ward.ts, summon-cast.ts, summon-defender.ts).
  arcane_ward: { file: "src/lib/dm/pc-damage.ts", call: "absorbByWard(" },
  summon_temp_hp: { file: "src/lib/dm/summon-cast.ts", call: "authoredSummonTempHp(" },
  defender_upgrade: { file: "src/lib/dm/summon-defender.ts", call: "defenderUpgrade(" },
  spend: { file: "src/lib/dm/mutations.ts", call: "authoredFeatureSpend(" },
  reaction: { file: "src/lib/dm/reaction-tools.ts", call: "authoredReaction(" },
};

export function authoredEffectKinds(): string[] {
  const kinds = new Set<string>();
  for (const row of authoredRows()) {
    for (const effect of row.entry.effects ?? []) {
      kinds.add(effect.kind);
    }
    if (row.entry.spends?.length) {
      kinds.add("spend");
    }
    if (row.entry.reactions?.length) {
      kinds.add("reaction");
    }
  }
  return [...kinds].sort();
}
