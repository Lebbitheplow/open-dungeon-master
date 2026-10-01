import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, orderEntryId, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { canEnemyAct, enemyActedThisRound, oweEnemiesAnAction } from "@/lib/dm/can-act";
import { rollExpression } from "@/lib/dice";
import {
  abilityFromLine,
  abilityKey,
  findMonsterAbility,
  enemyHpCap,
  REGENERATION_STOPPED,
  regenerationOf,
  rollRecharges,
  type MonsterAbility,
} from "@/lib/dm/monster-abilities";
import { patchEnemyHp } from "@/lib/db/encounters";
import {
  freshPool,
  legendaryProfile,
  refillActions,
  spendLegendaryAction,
  spendResistance,
  type LegendaryPool,
} from "@/lib/dm/legendary-logic";

// Legendary actions, lair actions and legendary resistance as tools
// (docs/vtt-parity-implementation-plan.md 4.1). Imports point downward
// only, like encounter-tools-extra: this module never imports
// encounter-tools, which dispatches to it.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const LEGENDARY_TOOL_NAMES = ["legendary_action", "legendary_resist", "lair_action"] as const;

export const legendaryTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "legendary_action",
      description:
        "A legendary creature spends one of its legendary actions at the END of another creature's turn. Name the action from its stat block; the server checks the pool (it refills at the start of the creature's own turn) and the cost. If the action is one of its attacks, follow with enemy_attack naming the same attack; otherwise narrate the effect the block describes.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
          action: { type: "string", description: "The legendary action's name as the stat block lists it." },
        },
        required: ["enemyId", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "legendary_resist",
      description:
        "Spend one use of Legendary Resistance so the creature succeeds on a save it just failed. The server keeps the count; a creature with none left is refused. The server already spends one on its own when a failed save would leave the creature under a condition; use this for anything else (a damaging save it must not fail).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { enemyId: { type: "string", description: "Exact enemyId from GAME STATE." } },
        required: ["enemyId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lair_action",
      description:
        "On initiative count 20 of each round, when the fight is in a lair, the lair itself acts once. Describe which lair action fires; the server records it and refuses a second one in the same round.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { action: { type: "string", description: "Which lair action, in a line." } },
        required: ["action"],
      },
    },
  },
];

// The pools a fight starts with: one per enemy the stat block calls
// legendary; the lair flag when the fight is in one.
export function initLegendaryPools(encounter: Encounter, enemies: EncounterEnemy[], lair: boolean): void {
  for (const enemy of enemies) {
    const profile = legendaryProfile(enemy.stats);
    if (profile) {
      encounter.legendary.pools[enemy.id] = freshPool(profile);
    }
  }
  encounter.legendary.lair = lair || enemies.some((enemy) => (legendaryProfile(enemy.stats)?.lairActions.length ?? 0) > 0);
}

// The enemy whose turn begins gets its legendary actions back, and rolls
// the d6 for each Recharge ability it has spent (SRD 5.1, Recharge X-Y).
// The caller saves the encounter. Returns a line per recharge roll.
export function refillLegendaryForTurn(encounter: Encounter, enemy: EncounterEnemy | undefined): string[] {
  if (!enemy) {
    return [];
  }
  const profile = legendaryProfile(enemy.stats);
  if (profile) {
    encounter.legendary.pools[enemy.id] = refillActions(encounter.legendary.pools[enemy.id], profile);
  }
  const lines: string[] = [];
  // Regeneration (SRD 5.1, trolls, vampires): hit points back at the start
  // of its turn, unless the damage that stops it landed since its last turn
  // (the condition enemy-damage.ts sets, which ends as this turn starts;
  // `enemy` is read from before that, so it still shows).
  const regeneration = regenerationOf(enemy.stats);
  if (regeneration && enemy.currentHp > 0) {
    // Chill Touch: a creature it struck cannot regain hit points.
    if (enemy.conditions.includes(REGENERATION_STOPPED) || enemy.conditions.includes("chill touch")) {
      lines.push(`${enemy.displayName} does not regenerate this turn.`);
    } else if (enemy.currentHp < enemyHpCap(enemy)) {
      // Never past the maximum, which exhaustion 4 halves.
      const healed = Math.min(enemyHpCap(enemy), enemy.currentHp + regeneration.amount);
      patchEnemyHp(enemy.id, healed, "alive");
      lines.push(`${enemy.displayName} regenerates ${healed - enemy.currentHp} hit points.`);
    }
  }
  const ledger = encounter.legendary.abilities?.[enemy.id];
  if (!ledger?.spent?.length) {
    return lines;
  }
  const abilities = [
    ...(enemy.stats.specials ?? []),
    ...(enemy.stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null),
  ];
  const rolled = rollRecharges(enemy.displayName, abilities, ledger, () => rollExpression("1d6").total);
  encounter.legendary.abilities = { ...(encounter.legendary.abilities ?? {}), [enemy.id]: rolled.ledger ?? {} };
  return [...lines, ...rolled.lines];
}

// A failed save that would leave a legendary creature under a condition
// is the moment a monster burns a resistance; the server does it so the
// model never forgets. Returns true when a resistance was spent.
export function autoLegendaryResistance(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy): boolean {
  const pool = encounter.legendary.pools[enemy.id];
  if (!pool) {
    return false;
  }
  const spent = spendResistance(pool);
  if (!spent) {
    return false;
  }
  encounter.legendary.pools[enemy.id] = spent;
  saveEncounter(encounter);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  return true;
}

function publishEncounter(campaign: Campaign) {
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
}

const actionSchema = z.object({ enemyId: z.string().min(1), action: z.string().trim().min(1).max(80) });

export function handleLegendaryAction(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof actionSchema>;
  try {
    args = actionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: legendary_action needs enemyId and action." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status}.` };
  }
  const profile = legendaryProfile(enemy.stats);
  if (!profile || !profile.actions.length) {
    return { error: `${enemy.displayName} has no legendary actions.` };
  }
  // A legendary action is still an action of the creature's: not while it
  // is incapacitated, and not while it is surprised.
  const allowed = canEnemyAct({ enemy, encounter, kind: "legendary" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const current = encounter.order[encounter.turnIndex];
  // Its own turn: the pointer on it, or its turn handed to the model by an
  // end_turn and not yet taken (the pointer never rests on an enemy).
  const turnDue =
    Boolean(encounter.legendary.handoff?.enemyIds.includes(enemy.id)) && !enemyActedThisRound(encounter, enemy.id);
  if ((current && orderEntryId(current) === enemy.id) || turnDue) {
    return { error: `It is ${enemy.displayName}'s own turn; legendary actions come at the end of other creatures' turns. Take its turn with enemy_attack (or its ability or spell) first.` };
  }
  const pool: LegendaryPool = encounter.legendary.pools[enemy.id] ?? freshPool(profile);
  const outcome = spendLegendaryAction(pool, profile, args.action);
  if (!outcome.ok) {
    return { error: outcome.error };
  }
  encounter.legendary.pools[enemy.id] = outcome.pool;
  const wanted = outcome.action.name.toLowerCase();
  // "Tail Attack", or "uses its Paralyzing Touch": the line names an attack.
  const attack = enemy.stats.attacks.find((entry) => {
    const name = entry.name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    return name === wanted || wanted.includes(name) || name.includes(wanted) || outcome.action.text.toLowerCase().includes(`its ${name}`);
  });
  // A line with its own numbers (Wing Attack's DC 22 save) resolves through
  // aoe_damage or cast_at_player naming it; "casts a cantrip" through a
  // cantrip from the creature's list. Either is bought here and spent there.
  const ability = findMonsterAbility(enemy.stats, outcome.action.name);
  const effect = !attack && ability && (ability.save || ability.damage) ? abilityKey(ability.name) : null;
  const cantrip = !attack && !effect && /casts? a cantrip/i.test(outcome.action.text) ? "cantrip" : null;
  if (attack) {
    // The attack this action buys is on top of the creature's one action a
    // round, so enemy_attack is owed one more, and it is one swing.
    oweEnemiesAnAction(encounter, [enemy.id]);
    encounter.legendary.strikes = [...(encounter.legendary.strikes ?? []), enemy.id];
  }
  const bought = effect ?? cantrip;
  if (bought) {
    const ledger = encounter.legendary.abilities?.[enemy.id] ?? {};
    encounter.legendary.abilities = {
      ...(encounter.legendary.abilities ?? {}),
      [enemy.id]: { ...ledger, bought: [...(ledger.bought ?? []), bought] },
    };
  }
  saveEncounter(encounter);
  publishEncounter(campaign);
  return {
    ok: true,
    enemy: enemy.displayName,
    action: outcome.action.name,
    text: outcome.action.text,
    remaining: outcome.pool.actions,
    ...(attack ? { next: `Resolve it now with enemy_attack (enemyId ${enemy.id}, attack "${attack.name}"): one attack.` } : {}),
    ...(effect
      ? { next: `Resolve it now with aoe_damage (or cast_at_player for one target) with casterEnemyId ${enemy.id} and ability "${ability?.name}"; the server takes its DC and dice from the block.` }
      : {}),
    ...(cantrip ? { next: `Resolve it now with the cantrip from its list: cast_at_player or aoe_damage with casterEnemyId ${enemy.id} and spell.` } : {}),
  };
}

const resistSchema = z.object({ enemyId: z.string().min(1) });

export function handleLegendaryResist(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof resistSchema>;
  try {
    args = resistSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: legendary_resist needs enemyId." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  const pool = encounter.legendary.pools[enemy.id];
  if (!pool) {
    return { error: `${enemy.displayName} has no Legendary Resistance.` };
  }
  const spent = spendResistance(pool);
  if (!spent) {
    return { error: `${enemy.displayName} has no Legendary Resistance left.` };
  }
  encounter.legendary.pools[enemy.id] = spent;
  saveEncounter(encounter);
  publishEncounter(campaign);
  return { ok: true, enemy: enemy.displayName, remaining: spent.resistances, note: "The failed save becomes a success; narrate the effect shrugged off." };
}

const lairSchema = z.object({ action: z.string().trim().min(1).max(300) });

export function handleLairAction(campaign: Campaign, turn: DmTurn | null, rawArguments: string): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof lairSchema>;
  try {
    args = lairSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: lair_action needs an action." };
  }
  if (!encounter.legendary.lair) {
    return { error: "This fight is not in a lair." };
  }
  if (encounter.legendary.lairUsedRound === encounter.round) {
    return { error: `The lair already acted this round (round ${encounter.round}).` };
  }
  encounter.legendary.lairUsedRound = encounter.round;
  saveEncounter(encounter);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content: `Lair action (initiative 20, round ${encounter.round}): ${args.action}`,
    ...(turn ? { dmTurnId: turn.id } : {}),
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  publishEncounter(campaign);
  return {
    ok: true,
    round: encounter.round,
    note: `The lair acts on initiative 20 of round ${encounter.round}: ${args.action}`,
    lairActions: legendaryLairLines(listEnemies(encounter.id)),
  };
}

function legendaryLairLines(enemies: EncounterEnemy[]): string[] {
  return enemies.flatMap((enemy) => legendaryProfile(enemy.stats)?.lairActions ?? []);
}
