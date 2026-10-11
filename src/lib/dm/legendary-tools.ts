import { z } from "zod";
import { dmRoll } from "@/lib/dm/roll-card";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, orderEntryId, saveEncounter, turnKey, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { insertCampaignMessage } from "@/lib/db/messages";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { canEnemyAct, enemyActedThisRound, oweEnemiesAnAction } from "@/lib/dm/can-act";
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
import { patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import {
  freshPool,
  lairResolution,
  legendaryProfile,
  pickLairOption,
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
        "A legendary creature spends one of its legendary actions at the END of another creature's turn: one option per turn that ends, never two at once. Name the action from its stat block; the server checks the pool (it refills at the start of the creature's own turn), the cost and the turn. If the action is one of its attacks, follow with enemy_attack naming the same attack; otherwise narrate the effect the block describes.",
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
        "Spend one use of Legendary Resistance so the creature succeeds on the save it just failed this round. The server keeps the count and the last failed save: it lifts what that save laid and gives back the hit points a success would have spared. With no failed save on record, or none left, it is refused. The server already spends one on its own when a failed save would leave the creature under a binding condition; use this for anything else (a damaging save it must not fail).",
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
        "On initiative count 20 of each round (losing ties), when the fight is in a lair, the lair itself acts once. The server announces the moment (\"Initiative 20: the lair stirs\") and refuses the call at any other. Name one of the lair options the block prints (its words or its number); a lair with none printed takes a line of your own. The server records it, refuses a second in the round, and says how an option with a save resolves.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { action: { type: "string", description: "Which printed lair option (its words or its number), or a line for a lair with none printed." } },
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
  const rolled = rollRecharges(enemy.displayName, abilities, ledger, () => dmRoll(encounter.campaignId, null, "custom", `${enemy.displayName}: recharge`, "1d6").total);
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
  // One option at the end of each other creature's turn: the turn is the
  // pointer's, and each enemy that acts since closes a turn of its own.
  const acted = encounter.legendary.acted?.round === encounter.round ? encounter.legendary.acted.ids.length : 0;
  const key = `${turnKey(encounter)}:${acted}`;
  const taken = encounter.legendary.opportunities?.key === key ? encounter.legendary.opportunities.ids : [];
  if (taken.includes(enemy.id)) {
    return {
      error: `${enemy.displayName} has already taken a legendary action at the end of this turn. It takes one option at the end of each other creature's turn; the next comes when another creature's turn ends. Nothing was spent.`,
    };
  }
  const pool: LegendaryPool = encounter.legendary.pools[enemy.id] ?? freshPool(profile);
  const outcome = spendLegendaryAction(pool, profile, args.action);
  if (!outcome.ok) {
    return { error: outcome.error };
  }
  encounter.legendary.pools[enemy.id] = outcome.pool;
  encounter.legendary.opportunities = { key, ids: [...taken, enemy.id] };
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
  // Legendary Resistance answers a save the creature has just failed: the
  // server keeps the last one (src/lib/dm/forced-save.ts) and turns exactly
  // that failure into a success, once.
  const failed = encounter.legendary.failedSave;
  if (!failed || failed.enemyId !== enemy.id || failed.round !== encounter.round || failed.resisted) {
    return {
      error: `${enemy.displayName} has no failed save to turn into a success this round. Legendary Resistance answers a save the server just rolled and the creature failed; nothing was spent.`,
    };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} already fell to that save; Legendary Resistance is spent before the effect lands. Nothing was spent.` };
  }
  const spent = spendResistance(pool);
  if (!spent) {
    return { error: `${enemy.displayName} has no Legendary Resistance left.` };
  }
  // Settle the save as a success: what it laid comes off, and the hit points
  // a success would have spared come back.
  const lower = (value: string | undefined) => (value ?? "").toLowerCase();
  let conditions = enemy.conditions;
  let meta = enemy.conditionMeta as ConditionMetaMap;
  const lifted: string[] = [];
  for (const name of failed.conditions ?? []) {
    const out = removeConditionInstances(conditions, meta, name, (entry) =>
      (!failed.spell || !entry.spell || lower(entry.spell) === lower(failed.spell)) && (!failed.source || !entry.source || entry.source === failed.source),
    );
    if (out.removed > 0) {
      lifted.push(name);
    }
    conditions = out.conditions;
    meta = out.meta;
  }
  if (lifted.length) {
    patchEnemyConditions(enemy.id, conditions, meta);
  }
  const refund = Math.min(failed.refund ?? 0, Math.max(0, enemyHpCap(enemy) - enemy.currentHp));
  if (refund > 0) {
    patchEnemyHp(enemy.id, enemy.currentHp + refund, "alive");
  }
  encounter.legendary.pools[enemy.id] = spent;
  encounter.legendary.failedSave = { ...failed, resisted: true };
  saveEncounter(encounter);
  publishEncounter(campaign);
  return {
    ok: true,
    enemy: enemy.displayName,
    remaining: spent.resistances,
    save: failed.detail,
    ...(lifted.length ? { lifted: lifted.join(", ") } : {}),
    ...(refund > 0 ? { restored: `${refund} hit points a success would have spared` } : {}),
    note: "The failed save is now a success and the server has settled it as one; narrate the effect shrugged off.",
  };
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
  // Initiative count 20, losing ties: the move that passed it opened the
  // lair's moment, and the next move closes it (encounter-tools.ts).
  const due = encounter.legendary.lairDue;
  if (due === undefined) {
    return {
      error: "The lair acts on initiative count 20 (losing ties): after every creature at 20 or higher has had its turn, before anyone lower. That moment has not come with this turn; the server announces it (\"Initiative 20: the lair stirs\"). Nothing was done.",
    };
  }
  if (encounter.legendary.lairUsedRound === due) {
    return { error: `The lair already acted this round (round ${due}).` };
  }
  // A block that prints its lair options is held to them.
  const enemies = listEnemies(encounter.id);
  const options = legendaryLairLines(enemies);
  const picked = options.length ? pickLairOption(options, args.action) : args.action;
  if (!picked) {
    return { error: `The lair's options are printed in its block; name one of them (or its number): ${options.map((line, at) => `${at + 1}. ${line}`).join(" ")}` };
  }
  const noRepeat = enemies.some((enemy) => (enemy.stats.traits ?? []).some((line) => /same (?:lair )?(?:effect|action) two rounds in a row/i.test(line)));
  if (options.length > 1 && noRepeat && encounter.legendary.lairLast === picked && encounter.legendary.lairUsedRound === due - 1) {
    return { error: `The lair cannot use the same effect two rounds in a row; it used this one last round. Choose another: ${options.filter((line) => line !== picked).join(" ")}` };
  }
  encounter.legendary.lairUsedRound = due;
  encounter.legendary.lairLast = picked;
  saveEncounter(encounter);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: "cue-battle",
    content: `Lair action (initiative 20, round ${due}): ${picked}`,
    ...(turn ? { dmTurnId: turn.id } : {}),
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
  publishEncounter(campaign);
  const resolution = options.length ? lairResolution(picked) : null;
  return {
    ok: true,
    round: due,
    note: `The lair acts on initiative 20 of round ${due}: ${picked}`,
    ...(resolution ? { next: resolution } : {}),
    lairActions: options,
  };
}

function legendaryLairLines(enemies: EncounterEnemy[]): string[] {
  return enemies.flatMap((enemy) => legendaryProfile(enemy.stats)?.lairActions ?? []);
}
