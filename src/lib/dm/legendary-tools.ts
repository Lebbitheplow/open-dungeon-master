import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, orderEntryId, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
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

// The enemy whose turn begins gets its actions back.
export function refillLegendaryForTurn(encounter: Encounter, enemy: EncounterEnemy | undefined): void {
  if (!enemy) {
    return;
  }
  const profile = legendaryProfile(enemy.stats);
  if (profile) {
    encounter.legendary.pools[enemy.id] = refillActions(encounter.legendary.pools[enemy.id], profile);
  }
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
  const current = encounter.order[encounter.turnIndex];
  if (current && orderEntryId(current) === enemy.id) {
    return { error: `It is ${enemy.displayName}'s own turn; legendary actions come at the end of other creatures' turns. Use enemy_attack.` };
  }
  const pool: LegendaryPool = encounter.legendary.pools[enemy.id] ?? freshPool(profile);
  const outcome = spendLegendaryAction(pool, profile, args.action);
  if (!outcome.ok) {
    return { error: outcome.error };
  }
  encounter.legendary.pools[enemy.id] = outcome.pool;
  saveEncounter(encounter);
  publishEncounter(campaign);
  const wanted = outcome.action.name.toLowerCase();
  const attack = enemy.stats.attacks.find((entry) => {
    const name = entry.name.toLowerCase();
    return name === wanted || wanted.includes(name) || name.includes(wanted);
  });
  return {
    ok: true,
    enemy: enemy.displayName,
    action: outcome.action.name,
    text: outcome.action.text,
    remaining: outcome.pool.actions,
    ...(attack ? { next: `Resolve it now with enemy_attack (enemyId ${enemy.id}, attack "${attack.name}").` } : {}),
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
  return { ok: true, round: encounter.round, lairActions: legendaryLairLines(listEnemies(encounter.id)) };
}

function legendaryLairLines(enemies: EncounterEnemy[]): string[] {
  return enemies.flatMap((enemy) => legendaryProfile(enemy.stats)?.lairActions ?? []);
}
