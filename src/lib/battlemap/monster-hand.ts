import { signed, type HandCard, type MonsterAbilityUse } from "@/lib/battlemap/hand-core";
import type { PublicEnemyAbility, PublicEnemyActions, PublicEnemyAttack } from "@/lib/dm/enemy-actions-view";

// The DM's hand: a monster's turn as cards (issue #108). A person running
// the table used to play every goblin through the console's form; the
// players had cards. This derives the same HandCard shape the players' fan
// draws from the DM projection's `actions` (src/lib/dm/enemy-actions-view.ts),
// and turns a played card into the console's own invoke call, so the dice,
// the reach, the conditions and the audit trail are the engine's exactly as
// they are when the form is used.
//
// Pure and database-free: scripts/test-monster-hand.mjs drives every branch.

export type MonsterHandEnemy = {
  id: string;
  name: string;
  status: string;
  conditions: string[];
  actions?: PublicEnemyActions;
};

export type MonsterAdvantage = "none" | "advantage" | "disadvantage";

const SAVE_WORDS: Record<string, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

function saveWord(code: string): string {
  return SAVE_WORDS[code.trim().toLowerCase()] ?? code.toUpperCase();
}

function cardKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// "Multiattack: 2 Claw, 1 Bite" from the swings one call makes.
export function swingsLine(swings: string[]): string {
  if (swings.length <= 1) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const name of swings) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return `Multiattack: ${[...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ")}. One card plays the whole routine.`;
}

const BASE = {
  cost: "action" as const,
  resource: "",
  condition: "",
  heals: false,
  compose: false,
};

function attackCard(enemy: MonsterHandEnemy, actions: PublicEnemyActions, attack: PublicEnemyAttack): HandCard {
  return {
    ...BASE,
    id: `monster:${enemy.id}:attack:${cardKey(attack.name)}`,
    type: "attack",
    name: attack.name,
    range: attack.range,
    dice: `${attack.damage} ${attack.type}`.trim(),
    roll: `${signed(attack.toHit)} to hit`,
    rules: [swingsLine(attack.swings), attack.spellAttack ? "A spell attack." : ""].filter(Boolean).join(" "),
    condition: attack.onHit ?? "",
    icon: { kind: "action", key: "attack" },
    target: "enemy",
    toHit: attack.toHit,
    damage: attack.damage || null,
    damageType: attack.type.split("/")[0] ?? "",
    save: null,
    melee: attack.melee,
    disabled: actions.refusal,
    spent: actions.acted,
    intent: { card: "monster", enemyId: enemy.id, action: "attack", attackName: attack.name },
  };
}

function abilityCard(enemy: MonsterHandEnemy, actions: PublicEnemyActions, ability: PublicEnemyAbility): HandCard {
  const use: MonsterAbilityUse = {
    name: ability.name,
    save: ability.save,
    dc: ability.dc,
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.damageType ? { damageType: ability.damageType } : {}),
    ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
    ...(ability.condition ? { condition: ability.condition } : {}),
    ...(ability.rounds ? { rounds: ability.rounds } : {}),
  };
  const rules = [
    ability.halfOnSave ? "Half damage on a save." : "",
    ability.rounds ? `Lasts ${ability.rounds} round${ability.rounds === 1 ? "" : "s"}.` : "",
    "Pick everyone caught in it.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...BASE,
    id: `monster:${enemy.id}:ability:${cardKey(ability.name)}`,
    type: ability.damage ? "spell" : "control",
    name: ability.name,
    range: "",
    dice: ability.damage ? `${ability.damage} ${ability.damageType ?? ""}`.trim() : (ability.condition ?? ""),
    roll: `${saveWord(ability.save)} save DC ${ability.dc}`,
    rules,
    resource: ability.resource,
    condition: ability.condition ?? "",
    icon: { kind: "action", key: "cast" },
    target: "enemy",
    toHit: null,
    damage: ability.damage ?? null,
    damageType: ability.damageType ?? "",
    save: { ability: saveWord(ability.save), dc: ability.dc },
    melee: false,
    // The ability's own reason first (not recharged), then the turn's.
    disabled: ability.refusal ?? actions.refusal,
    spent: Boolean(ability.refusal) || actions.acted,
    intent: { card: "monster", enemyId: enemy.id, action: "ability", ability: use },
  };
}

function fleeCard(enemy: MonsterHandEnemy): HandCard {
  return {
    ...BASE,
    id: `monster:${enemy.id}:flee`,
    type: "basic",
    name: "Flee",
    cost: "free",
    range: "",
    dice: "",
    roll: "no roll",
    rules: "Leaves the fight alive. The party still earns it.",
    icon: { kind: "action", key: "escape" },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    save: null,
    melee: false,
    disabled: enemy.status === "alive" ? null : `${enemy.name} is ${enemy.status}.`,
    spent: false,
    intent: { card: "monster", enemyId: enemy.id, action: "flee" },
  };
}

// The cards one enemy holds: its attacks, its save abilities, and breaking
// off. Empty for an enemy the projection carries no actions for (a player's
// view, or an older server).
export function deriveMonsterHand(enemy: MonsterHandEnemy): HandCard[] {
  const actions = enemy.actions;
  if (!actions) {
    return [];
  }
  return [
    ...actions.attacks.map((attack) => attackCard(enemy, actions, attack)),
    ...actions.abilities.map((ability) => abilityCard(enemy, actions, ability)),
    fleeCard(enemy),
  ];
}

// Whether the card takes several targets at once (a breath weapon catches
// everyone in its cone; one call spends one action).
export function takesManyTargets(card: HandCard): boolean {
  return card.intent.card === "monster" && card.intent.action === "ability";
}

function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The line the aim bar shows for the raised card.
export function monsterSentence(enemyName: string, card: HandCard, targetNames: string[]): string {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return "";
  }
  const who = listNames(targetNames);
  if (intent.action === "attack") {
    return who ? `${enemyName} attacks ${who} with its ${card.name}.` : `${enemyName} attacks with its ${card.name}.`;
  }
  if (intent.action === "ability") {
    return who ? `${enemyName} uses ${card.name} on ${who}.` : `${enemyName} uses ${card.name}.`;
  }
  return `${enemyName} breaks off and flees.`;
}

// The console call a played card makes: the same adjudication the form
// would send, so the server's rules are the only rules. Null when the card
// still needs a target.
export function monsterInvoke(
  card: HandCard,
  targetIds: string[],
  advantage: MonsterAdvantage = "none",
): { name: string; args: Record<string, unknown> } | null {
  const intent = card.intent;
  if (intent.card !== "monster") {
    return null;
  }
  if (intent.action === "flee") {
    return { name: "enemy_flees", args: { enemyId: intent.enemyId, reason: "Breaks off and runs." } };
  }
  if (!targetIds.length) {
    return null;
  }
  if (intent.action === "attack") {
    return {
      name: "enemy_attack",
      args: {
        enemyId: intent.enemyId,
        targetCharacterId: targetIds[0],
        ...(intent.attackName ? { attack: intent.attackName } : {}),
        ...(advantage !== "none" ? { advantage } : {}),
      },
    };
  }
  const ability = intent.ability;
  if (!ability) {
    return null;
  }
  const numbers = {
    saveAbility: ability.save,
    dc: ability.dc,
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : {}),
  };
  if (targetIds.length === 1) {
    return {
      name: "cast_at_player",
      args: {
        characterId: targetIds[0],
        casterEnemyId: intent.enemyId,
        ability: ability.name,
        ...numbers,
        ...(ability.damageType ? { damageType: ability.damageType } : {}),
        ...(ability.condition ? { condition: ability.condition } : {}),
        ...(ability.rounds ? { rounds: ability.rounds } : {}),
      },
    };
  }
  return {
    name: "aoe_damage",
    args: {
      casterEnemyId: intent.enemyId,
      ability: ability.name,
      characterIds: targetIds,
      ...numbers,
      ...(ability.damageType ? { type: ability.damageType } : {}),
    },
  };
}
