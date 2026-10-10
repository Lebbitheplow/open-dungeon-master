import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { manualTraits } from "@/lib/dm/monster-traits";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { canEnemyAct, enemyActedThisRound } from "@/lib/dm/can-act";
import { plannedSwings } from "@/lib/dm/enemy-profile";
import { abilityFromLine, abilityRefusal, type MonsterAbility } from "@/lib/dm/monster-abilities";

// What an enemy can do on its turn, for the person running it (issue #108).
//
// A human DM used to play a goblin from a form: pick the attacker, pick the
// target, type the attack's name. The players meanwhile had cards. This is
// the DM's side of the same projection: every attack the block lists with
// the numbers the engine will roll, every save ability with its DC and what
// stops it right now, and the engine's own answer to "may it act". Only the
// DM view carries it (encounter-view.ts adds it under enemyNumbers), and
// every number is read from the same stat block enemy_attack, cast_at_player
// and aoe_damage read, so a card never promises what the engine refuses.
//
// Pure: scripts/test-monster-hand.mjs drives it with no database.

export type PublicEnemyAttack = {
  name: string;
  toHit: number;
  // A dice expression ("1d6+2"), as enemy_attack rolls it.
  damage: string;
  // Every damage type, "/" joined; the first is the hit's own.
  type: string;
  // "5 ft", "80/320 ft", or "5 ft / 20/60 ft" for a thrown weapon.
  range: string;
  melee: boolean;
  spellAttack?: boolean;
  // What a hit does besides its damage, in a few words.
  onHit?: string;
  // The swings one enemy_attack naming this attack makes, by name: the
  // Multiattack routine it sits in (plannedSwings), or just itself.
  swings: string[];
};

export type PublicEnemyAbility = {
  name: string;
  // The save's ability code ("dex") and DC, always present: an ability with
  // neither is a trait, not an action card.
  save: string;
  dc: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  // "Recharge 5-6", "1/day", "Once a fight"; "" when unlimited.
  resource: string;
  // Why it cannot be used now (not recharged, used up), or null.
  refusal: string | null;
};

export type PublicEnemyActions = {
  speed: string;
  attacks: PublicEnemyAttack[];
  abilities: PublicEnemyAbility[];
  // The engine's own reason it may not take an action now (dead,
  // incapacitated, surprised, already acted), or null when it may.
  refusal: string | null;
  // It has taken its action this round.
  acted: boolean;
  // The traits on its block the engine does not resolve: the DM applies
  // them by hand (src/lib/dm/monster-traits.ts manualTraits).
  manual: string[];
};

type ActingEncounter = Pick<
  Encounter,
  "orderReady" | "order" | "turnIndex" | "round" | "surprisedIds" | "kind" | "status" | "legendary"
>;

function attackRange(attack: EnemyAttack): string {
  const reach = `${attack.reach ?? 5} ft`;
  const range = attack.range ? `${attack.range.normal}/${attack.range.long} ft` : "";
  const mode = attack.mode ?? (attack.range && !attack.reach ? "ranged" : "melee");
  if (mode === "ranged") {
    return range || reach;
  }
  if (mode === "both" && range) {
    return `${reach} / ${range}`;
  }
  return reach;
}

function onHitLine(attack: EnemyAttack): string | undefined {
  const rider = attack.onHit;
  if (!rider) {
    return undefined;
  }
  const parts = [
    rider.condition ? (rider.save && rider.dc ? `${rider.condition} on a failed ${rider.save.toUpperCase()} ${rider.dc}` : rider.condition) : "",
    rider.alsoCondition ?? "",
    rider.damage ? `${rider.damage} ${rider.damageType ?? ""}`.trim() : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function abilityResource(ability: MonsterAbility): string {
  if (ability.recharge) {
    return ability.recharge === 6 ? "Recharge 6" : `Recharge ${ability.recharge}-6`;
  }
  if (ability.perDay) {
    return `${ability.perDay}/day`;
  }
  if (ability.perRest) {
    return "Once a fight";
  }
  return "";
}

// The block's abilities with numbers the engine runs: the parsed specials,
// else the trait lines read the same way findMonsterAbility reads them.
function abilitiesOf(enemy: EncounterEnemy): MonsterAbility[] {
  const stats = enemy.stats;
  const parsed = stats.specials?.length
    ? stats.specials
    : (stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null);
  const seen = new Set<string>();
  return parsed.filter((ability) => {
    const key = ability.name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function enemyActionsView(encounter: ActingEncounter, enemy: EncounterEnemy): PublicEnemyActions {
  const stats = enemy.stats;
  // The same fallback enemy_attack makes for a block with no attack lines.
  const attacks = stats.attacks?.length ? stats.attacks : synthesizeStats(enemy.cr).attacks;
  const seen = new Set<string>();
  const attackViews: PublicEnemyAttack[] = [];
  for (const attack of attacks) {
    const key = attack.name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const onHit = onHitLine(attack);
    attackViews.push({
      name: attack.name,
      toHit: attack.toHit,
      damage: attack.damage,
      type: attack.type,
      range: attackRange(attack),
      melee: (attack.mode ?? (attack.range && !attack.reach ? "ranged" : "melee")) !== "ranged",
      ...(attack.spellAttack ? { spellAttack: true } : {}),
      ...(onHit ? { onHit } : {}),
      swings: plannedSwings(stats, attacks, attack.name).map((swing) => swing.name),
    });
  }

  const ledger = encounter.legendary.abilities?.[enemy.id];
  const abilityViews: PublicEnemyAbility[] = abilitiesOf(enemy)
    // A legendary action is spent at the end of another creature's turn,
    // through legendary_action; it is not one of the turn's cards.
    .filter((ability) => ability.save && ability.dc && !ability.legendaryCost)
    .map((ability) => ({
      name: ability.name,
      save: ability.save as string,
      dc: ability.dc as number,
      ...(ability.damage ? { damage: ability.damage } : {}),
      ...(ability.damageType ? { damageType: ability.damageType } : {}),
      ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
      ...(ability.condition ? { condition: ability.condition } : {}),
      ...(ability.rounds ? { rounds: ability.rounds } : {}),
      resource: abilityResource(ability),
      refusal: abilityRefusal(enemy.displayName, ability, ledger),
    }));

  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  return {
    speed: stats.speed || "30 ft.",
    attacks: attackViews,
    abilities: abilityViews,
    refusal: allowed.ok ? null : allowed.error,
    acted: enemyActedThisRound(encounter, enemy.id),
    manual: manualTraits(stats),
  };
}
