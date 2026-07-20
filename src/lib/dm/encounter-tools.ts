import { z } from "zod";
import {
  allocateSeq,
  getCampaignById,
  latestSeq,
  setFloor,
  getFloor,
  type Campaign,
  type InitiativeFloor,
} from "@/lib/db/campaigns";
import {
  createEncounter,
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  saveEncounter,
  type Encounter,
  type EncounterEnemy,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getRoll, insertRoll } from "@/lib/db/rolls";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listOpenPendingRolls, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { suggestEnemies } from "@/lib/bestiary";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { enemyRequestSchema, resolveEnemyRequests } from "@/lib/dm/encounter-spawn";
import { healthState } from "@/lib/bestiary/health";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import {
  advanceOrder,
  buildOrder,
  coerceEncounterOutcome,
  critDamageExpression,
  numberDuplicates,
  pickEnemyTarget,
} from "@/lib/dm/encounter-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import {
  approachForAttack,
  createBattleMapForEncounter,
  handleMoveToken,
  isRangedAttackName,
  moveTokenTool,
  publishBattleMapUpdate,
} from "@/lib/dm/map-tools";
import {
  applyEnemyDamage,
  finishEncounter,
  publishEncounter,
  resolveEnemyRef,
} from "@/lib/dm/enemy-damage";
import {
  applyExtraEncounterCall,
  EXTRA_ENCOUNTER_TOOL_NAMES,
  extraEncounterTools,
} from "@/lib/dm/encounter-tools-extra";
import { handlePcAttack, pcAttackTool } from "@/lib/dm/pc-attack";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import { castAtEnemyTool, handleCastAtEnemy } from "@/lib/dm/cast-tools";
import {
  attackContext,
  incapacitatedBy,
  isIncapacitated,
} from "@/lib/dm/condition-logic";
import { tickEncounterConditions } from "@/lib/dm/condition-tick";
import { rollDeathSave } from "@/lib/dm/death";
import { getBattleMapForEncounter, getTokenByRef, resetRoundBudgets } from "@/lib/db/battle-maps";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Server-authoritative combat: enemies spawn from real stat blocks, their
// HP changes only through these tools, and the initiative pointer is moved
// by the server (finalize/lead skip), never by the model.

export const ENCOUNTER_TOOL_NAMES = [
  "start_encounter",
  "pc_attack",
  "cast_at_enemy",
  "damage_enemy",
  "enemy_attack",
  "move_token",
  "end_encounter",
  ...EXTRA_ENCOUNTER_TOOL_NAMES,
];

export const ENCOUNTER_CAP_PER_TURN = 12;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const startEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "start_encounter",
    description:
      "Begin combat with real, server-tracked enemies. Call this BEFORE narrating the first hostile exchange. Use monster slugs or names from the Enemy picks list, or any 5e monster; give an in-world name to reskin one for this setting.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemies: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              monster: {
                type: "string",
                description: "Monster slug or name, e.g. 'goblin' or 'Gutter Punk'.",
              },
              name: {
                type: "string",
                description: "Optional in-world display name when reskinning.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
            },
            required: ["monster"],
          },
        },
        summary: { type: "string", description: "One line on what this fight is." },
        battlefield: {
          type: "string",
          description:
            "One line describing the fighting ground, used to shape the tactical battle map, e.g. 'a torchlit crypt with a flooded channel'.",
        },
      },
      required: ["enemies"],
    },
  },
};

const damageEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "damage_enemy",
    description:
      "Deal damage to an enemy in the active encounter. Call it BEFORE narrating a blow landing; the enemy dies only when the result says dead: true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        amount: { type: "integer", minimum: 1, maximum: 200 },
        type: { type: "string", description: "Damage type, e.g. slashing, fire." },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId", "amount"],
    },
  },
};

const enemyAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_attack",
    description:
      "An enemy attacks a character. The server rolls to-hit from the enemy's real stat block against the target's real AC and applies real damage. Never invent an enemy's numbers or use request_roll for enemy attacks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        targetCharacterId: {
          type: "string",
          description: "Exact characterId from GAME STATE.",
        },
        attack: {
          type: "string",
          description: "Attack name from the enemy's attack list; defaults to its first.",
        },
        advantage: { type: "string", enum: ["none", "advantage", "disadvantage"] },
      },
      required: ["enemyId", "targetCharacterId"],
    },
  },
};

const endEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "end_encounter",
    description:
      "End the active encounter when it resolves any way other than every enemy dying: flight, surrender, parley, or party defeat. Victory by killing every enemy ends automatically.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: {
          type: "string",
          enum: ["victory", "enemies_fled", "party_fled", "party_defeated", "truce"],
        },
        reason: { type: "string" },
      },
      required: ["outcome"],
    },
  },
};

export function encounterTools(hasActiveEncounter: boolean): ToolDef[] {
  return hasActiveEncounter
    ? [
        pcAttackTool,
        castAtEnemyTool,
        damageEnemyTool,
        enemyAttackTool,
        moveTokenTool,
        endEncounterTool,
        ...extraEncounterTools,
      ]
    : [startEncounterTool];
}

function crLabel(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// ---- start_encounter ----

const startArgsSchema = z.object({
  enemies: z.array(enemyRequestSchema).min(1).max(8),
  summary: z.string().optional(),
  battlefield: z.string().max(300).optional(),
});

// Accepts the documented {enemies:[...]} shape, or flat monster/name/count
// keys (the textual-salvage path cannot produce arrays).
function parseStartArgs(rawArguments: string): z.infer<typeof startArgsSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const nested = startArgsSchema.safeParse(raw);
  if (nested.success) {
    return nested.data;
  }
  const flat = enemyRequestSchema
    .extend({ summary: z.string().optional(), battlefield: z.string().max(300).optional() })
    .safeParse(raw);
  if (flat.success) {
    return {
      enemies: [{ monster: flat.data.monster, name: flat.data.name, count: flat.data.count, cr: flat.data.cr }],
      summary: flat.data.summary,
      battlefield: flat.data.battlefield,
    };
  }
  return null;
}

function suggestionLines(campaign: Campaign, sheets: CharacterSheet[]): string {
  return suggestEnemies(campaign.gameSettings.genre, sheets.map((sheet) => sheet.level), 5)
    .map((entry) => `${entry.slug} as "${entry.name}" (CR ${crLabel(entry.cr)})`)
    .join(", ");
}

function handleStartEncounter(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
): Record<string, unknown> {
  const args = parseStartArgs(rawArguments);
  if (!args) {
    return {
      error:
        'Invalid start_encounter arguments. Send {"enemies":[{"monster":"goblin","count":3}],"summary":"..."}.',
    };
  }
  if (getActiveEncounter(campaign.id)) {
    return {
      error:
        "An encounter is already active. Use damage_enemy and enemy_attack, or end_encounter first.",
    };
  }
  if (!sheets.length) {
    return { error: "No party characters to fight." };
  }

  // Resolve every requested enemy before creating anything.
  const outcome = resolveEnemyRequests(campaign.gameSettings.genre, args.enemies);
  if ("unknownMonster" in outcome) {
    return {
      error: `Unknown monster "${outcome.unknownMonster}". Use a real monster slug or name, or pass cr for an invented enemy. Good picks for this world: ${suggestionLines(campaign, sheets)}.`,
    };
  }
  const resolved = outcome.resolved;
  if (resolved.length > 8) {
    return { error: "Too many enemies; keep encounters to 8 combatants or fewer." };
  }

  // 5e budget check: refuse fights the party cannot plausibly survive.
  const partyLevels = sheets.map((sheet) => sheet.level);
  const evaluation = evaluateEncounter(partyLevels, resolved.map((entry) => entry.stats.cr));
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  if (evaluation.adjustedXp > ceiling) {
    return {
      error: `Too deadly for this party: adjusted XP ${evaluation.adjustedXp} vs an allowed ceiling of ${ceiling} (difficulty ${campaign.difficulty}). Use fewer or weaker enemies. Good picks for this world: ${suggestionLines(campaign, sheets)}.`,
    };
  }

  const encounter = createEncounter(campaign.id, args.summary ?? "");
  if (!encounter) {
    return { error: "An encounter is already active." };
  }

  const names = numberDuplicates(resolved.map((entry) => entry.name));
  const enemies = resolved.map((entry, index) =>
    insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: entry.slug,
      displayName: names[index],
      // Enemy initiative rolls silently at spawn; players roll on request.
      initiative: rollExpression(d20Expression(entry.stats.dexMod)).total,
      stats: entry.stats,
    }),
  );
  createBattleMapForEncounter(campaign, encounter, enemies, sheets, args.battlefield);
  publishEncounter(campaign.id);

  const rollList = sheets
    .map((sheet) => `${sheet.name} (characterId=${sheet.id})`)
    .join(", ");
  return {
    ok: true,
    encounterId: encounter.id,
    enemies: enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      ac: enemy.ac,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
    })),
    difficulty: `${evaluation.verdict} for this party`,
    ...(evaluation.verdict === "deadly" || evaluation.verdict === "beyond_deadly"
      ? { warning: "This fight can kill characters. Telegraph the danger." }
      : {}),
    map: "A tactical battle map was generated; positions appear in GAME STATE on your next call.",
    next: `Now call request_roll with kind=initiative for EACH character: ${rollList}. Combat begins once every initiative is in.`,
  };
}

// ---- initiative collection ----

// Whether this combatant can take a turn: alive AND (for PCs) not
// incapacitated. A stunned or paralyzed PC's turn is skipped exactly like a
// downed one; the condition ticks away at round wrap. Enemies stay in the
// passed list either way (enemy_attack refuses the incapacitated ones).
function entryAlive(entry: OrderEntry, enemiesById: Map<string, EncounterEnemy>): boolean {
  if (entry.kind === "pc") {
    const sheet = getSheetById(entry.characterId);
    return (sheet?.currentHp ?? 0) > 0 && !isIncapacitated(sheet?.conditions ?? []);
  }
  return enemiesById.get(entry.enemyId)?.status === "alive";
}

function setInitiativeFloor(campaign: Campaign | null, encounter: Encounter) {
  if (!campaign) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  const floor: InitiativeFloor = {
    mode: "initiative",
    encounterId: encounter.id,
    userIds: [current.userId],
    currentName: current.name,
    round: encounter.round,
  };
  setFloor(campaign.id, floor);
  publishPersisted(campaign.id, "floor_changed", { floor });
}

function describeOrder(encounter: Encounter): string {
  return encounter.order
    .map((entry, index) => (index === encounter.turnIndex ? `${entry.name} (CURRENT)` : entry.name))
    .join(" > ");
}

// Records one PC's initiative result. When the last one lands, builds the
// order, points the turn at the first living PC, and locks the floor.
// Returns a note for the model when combat begins.
export function recordInitiativeRoll(
  campaignId: string,
  characterId: string | null,
  total: number,
): string | null {
  if (!characterId) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || encounter.orderReady) {
    return null;
  }
  const sheet = getSheetById(characterId);
  if (!sheet || encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === characterId)) {
    return null;
  }
  encounter.order.push({
    kind: "pc",
    characterId: sheet.id,
    userId: sheet.userId,
    name: sheet.name,
    initiative: total,
  });

  const sheets = listSheets(campaignId);
  const staged = encounter.order.filter(
    (entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc",
  );
  if (staged.length < sheets.length) {
    saveEncounter(encounter);
    return null;
  }

  // Everyone is in: build the final order and open combat.
  const enemies = listEnemies(encounter.id);
  encounter.order = buildOrder(
    staged,
    enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      initiative: enemy.initiative ?? 0,
    })),
  );
  const enemiesById = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const first = advanceOrder(encounter.order, -1, (entry) => entryAlive(entry, enemiesById));
  if (!first) {
    saveEncounter(encounter);
    return null;
  }
  encounter.orderReady = true;
  encounter.turnIndex = first.turnIndex;
  encounter.waitingSeq = latestSeq(campaignId);
  saveEncounter(encounter);
  const campaign = getCampaignById(campaignId);
  setInitiativeFloor(campaign, encounter);
  publishEncounter(campaignId);
  if (campaign) {
    for (const passedCharacterId of first.pcsPassed) {
      rollDeathSave(campaign, passedCharacterId);
    }
  }

  const actFirst = first.enemiesPassed
    .map((enemyId) => enemiesById.get(enemyId)?.displayName)
    .filter(Boolean);
  const current = encounter.order[encounter.turnIndex];
  return `Combat begins. Initiative order: ${describeOrder(encounter)}.${
    actFirst.length
      ? ` ${actFirst.join(" and ")} act${actFirst.length === 1 ? "s" : ""} first: call enemy_attack for each now, then narrate and stop.`
      : ` It is ${current?.name}'s turn; narrate the scene and stop for their action.`
  }`;
}

// Deadlock guard: if combat is stuck collecting initiative with nothing
// pending, roll the stragglers digitally so a fight can never wedge.
export function ensureInitiativeProgress(campaign: Campaign): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || encounter.orderReady) {
    return null;
  }
  if (listOpenPendingRolls(campaign.id).length) {
    return null;
  }
  const staged = new Set(
    encounter.order
      .filter((entry): entry is Extract<OrderEntry, { kind: "pc" }> => entry.kind === "pc")
      .map((entry) => entry.characterId),
  );
  const missing = listSheets(campaign.id).filter((sheet) => !staged.has(sheet.id));
  if (!missing.length) {
    return null;
  }
  let note: string | null = null;
  for (const sheet of missing) {
    const outcome = rollExpression(
      d20Expression(computeSheetDerived(sheet).initiative),
    );
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "initiative",
      detail: "initiative",
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    note = recordInitiativeRoll(campaign.id, sheet.id, outcome.total) ?? note;
  }
  return note;
}

// ---- damage_enemy ----

const damageArgsSchema = z.object({
  enemyId: z.string(),
  amount: z.number().int().min(1).max(200),
  type: z.string().optional(),
  reason: z.string().optional(),
});

function handleDamageEnemy(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first." };
  }
  let args: z.infer<typeof damageArgsSchema>;
  try {
    args = damageArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: damage_enemy needs enemyId and amount." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  // Double-apply guard: a damage roll carrying targetEnemyId already landed
  // this hit the moment the dice resolved; a damage_enemy call repeating the
  // same number out of habit must not stack the damage.
  const alreadyApplied = turn.rollIds
    .map((rollId) => getRoll(rollId))
    .some(
      (roll) => roll?.applied && roll.targetEnemyId === enemy.id && roll.total === args.amount,
    );
  if (alreadyApplied) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      note: "That damage was already applied when the roll resolved; nothing more to apply. Narrate from this state.",
    };
  }
  return applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    args.amount,
    sheets,
    sheetsById,
    args.type,
  );
}

// ---- enemy_attack ----

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  attack: z.string().optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
});

function pickAttack(enemy: EncounterEnemy, requested: string | undefined): EnemyAttack | null {
  const attacks = enemy.stats.attacks.length
    ? enemy.stats.attacks
    : synthesizeStats(enemy.cr).attacks;
  if (!attacks.length) {
    return null;
  }
  const wanted = (requested ?? "").trim().toLowerCase();
  if (wanted) {
    const match = attacks.find(
      (attack) =>
        attack.name.toLowerCase() === wanted || attack.name.toLowerCase().includes(wanted),
    );
    if (match) {
      return match;
    }
  }
  return attacks[0];
}

function handleEnemyAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof attackArgsSchema>;
  try {
    args = attackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_attack needs enemyId and targetCharacterId." };
  }
  const enemy = resolveEnemyRef(encounter.id, args.enemyId);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is ${enemy.status} and cannot attack.` };
  }
  const stoppedBy = incapacitatedBy(enemy.conditions);
  if (stoppedBy) {
    return {
      error: `${enemy.displayName} is ${stoppedBy} and cannot act this turn.`,
    };
  }
  const staleTarget =
    sheetsById.get(args.targetCharacterId.trim()) ??
    sheets.find(
      (sheet) => sheet.name.toLowerCase() === args.targetCharacterId.trim().toLowerCase(),
    );
  const target = staleTarget ? getSheetById(staleTarget.id) : null;
  if (!target) {
    return { error: "Unknown targetCharacterId; use one from GAME STATE." };
  }
  const attack = pickAttack(enemy, args.attack);
  if (!attack) {
    return { error: `${enemy.displayName} has no usable attacks; narrate a different action.` };
  }

  // Battle-map positions are authoritative: a melee attacker out of reach
  // auto-approaches along a legal path, and the attack is refused when the
  // target is still beyond range, so narration can never teleport enemies.
  const spatial = approachForAttack(campaign, encounter.id, enemy.id, target.id, attack.name);
  if (spatial?.blocked) {
    return spatial.blocked;
  }

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  const ranged = isRangedAttackName(attack.name);
  const conditionContext = attackContext({
    attackerConditions: enemy.conditions,
    targetConditions: target.conditions,
    melee: !ranged,
    adjacent: !ranged,
    requested: args.advantage ?? "none",
  });

  // Multiattack: the full routine executes in this ONE call, each swing its
  // own to-hit and damage dice cards, stopping early if the target drops.
  const advantage: Advantage = conditionContext.advantage;
  const totalSwings = Math.max(1, Math.min(3, enemy.stats.attacksPerTurn ?? 1));
  const swings: Array<Record<string, unknown>> = [];
  let dropped = false;
  let totalDamage = 0;
  let targetHp: string | undefined;
  for (let swing = 0; swing < totalSwings && !dropped; swing += 1) {
    const hitOutcome = rollExpression(d20Expression(attack.toHit, advantage));
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: ${attack.name}`,
      advantage,
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    turn.rollIds.push(hitRoll.id);

    const natCrit = hitOutcome.crit === "nat20";
    const hit = hitOutcome.crit !== "nat1" && (natCrit || hitOutcome.total >= target.ac);
    const crit = natCrit || (hit && conditionContext.autoCrit);
    if (!hit) {
      swings.push({
        rolled: hitOutcome.total,
        hit: false,
        ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      });
      continue;
    }

    const damageExpression = crit ? critDamageExpression(attack.damage) : attack.damage;
    const damageOutcome = rollExpression(damageExpression);
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "damage",
      detail: `${enemy.displayName}: ${attack.name} damage`,
      result: damageOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });
    turn.rollIds.push(damageRoll.id);

    // Damage lands through the standard mutation: temp HP, clamps, audit,
    // and the live sheet_updated publish all come for free.
    const applied = applyDmMutation(
      campaign,
      turn.id,
      "apply_damage",
      JSON.stringify({
        characterId: target.id,
        amount: Math.max(1, damageOutcome.total),
        type: attack.type,
        // Crits against a dying target count double death-save failures.
        ...(crit ? { crit: true } : {}),
        reason: `${enemy.displayName}'s ${attack.name}`,
      }),
      sheets,
      sheetsById,
    ).result;
    totalDamage += damageOutcome.total;
    if (typeof applied.hp === "string") {
      targetHp = applied.hp;
    }
    if (applied.dropped) {
      dropped = true;
    }
    swings.push({
      rolled: hitOutcome.total,
      hit: true,
      ...(crit ? { crit: true } : {}),
      damage: damageOutcome.total,
    });
  }

  // The auto-act fallback in advanceAfterTurn skips enemies that already
  // took their turn here.
  if (!turn.actedEnemyIds.includes(enemy.id)) {
    turn.actedEnemyIds.push(enemy.id);
  }

  return {
    attack: attack.name,
    vsAc: target.ac,
    target: target.name,
    ...(totalSwings > 1 ? { multiattack: `${totalSwings} attacks` } : {}),
    swings,
    hit: swings.some((entry) => entry.hit),
    ...(totalDamage > 0 ? { totalDamage, damageType: attack.type } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    ...(targetHp ? { targetHp } : {}),
    ...(dropped ? { dropped: true, note: `${target.name} falls to 0 HP.` } : {}),
  };
}

// ---- end_encounter ----

// Outcome is deliberately a free string: a rejected end_encounter used to
// leave the fight stuck open while the narration declared it over.
// coerceEncounterOutcome maps synonyms and infers from the roster.
const endArgsSchema = z.object({
  outcome: z.string().max(80).optional(),
  reason: z.string().optional(),
});

function handleEndEncounter(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof endArgsSchema>;
  try {
    args = endArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    args = { outcome: undefined };
  }
  const statuses = listEnemies(encounter.id).map((enemy) => enemy.status);
  const { outcome, inferred } = coerceEncounterOutcome(args.outcome, statuses);
  return {
    ok: true,
    ...(inferred
      ? { note: `Outcome "${args.outcome ?? ""}" was not recognized; recorded as ${outcome}.` }
      : {}),
    ...finishEncounter(campaign, turn, encounter, outcome, sheets, sheetsById),
  };
}

// ---- dispatch ----

export function applyEncounterCall(
  campaign: Campaign,
  turn: DmTurn,
  toolName: string,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // pc_attack only: physical-dice roster and the call id its parked to-hit
  // roll answers on resume.
  callContext?: { realDiceUserIds: Set<string>; toolCallId: string | null },
): { result: Record<string, unknown> } {
  switch (toolName) {
    case "start_encounter":
      return { result: handleStartEncounter(campaign, rawArguments, sheets) };
    case "pc_attack":
      return {
        result: handlePcAttack(
          campaign,
          turn,
          rawArguments,
          sheets,
          sheetsById,
          callContext?.realDiceUserIds ?? new Set(),
          callContext?.toolCallId ?? null,
        ),
      };
    case "cast_at_enemy":
      return { result: handleCastAtEnemy(campaign, turn, rawArguments, sheets, sheetsById) };
    case "damage_enemy":
      return { result: handleDamageEnemy(campaign, turn, rawArguments, sheets, sheetsById) };
    case "enemy_attack":
      return { result: handleEnemyAttack(campaign, turn, rawArguments, sheets, sheetsById) };
    case "move_token":
      return { result: handleMoveToken(campaign, rawArguments, sheets, sheetsById) };
    case "end_encounter":
      return { result: handleEndEncounter(campaign, turn, rawArguments, sheets, sheetsById) };
    default:
      return (
        applyExtraEncounterCall(campaign, turn, toolName, rawArguments, sheets, sheetsById) ?? {
          result: { error: `Unknown encounter tool ${toolName}.` },
        }
      );
  }
}

// ---- server-driven turn advancement ----

function advancePointer(
  campaign: Campaign,
  encounter: Encounter,
): { enemiesPassed: string[] } | null {
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const next = advanceOrder(encounter.order, encounter.turnIndex, (entry) =>
    entryAlive(entry, enemiesById),
  );
  if (!next) {
    return null;
  }
  encounter.turnIndex = next.turnIndex;
  if (next.wrapped) {
    encounter.round += 1;
    // New round: timed conditions tick down, save-ends conditions re-save,
    // and movement budgets refill for every token.
    tickEncounterConditions(campaign, encounter);
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      resetRoundBudgets(map.id, encounter.round);
      publishBattleMapUpdate(campaign.id);
    }
  }
  encounter.waitingSeq = latestSeq(campaign.id);
  saveEncounter(encounter);
  setInitiativeFloor(campaign, encounter);
  publishEncounter(campaign.id);
  // Downed PCs the pointer skipped make their death saves now, once per
  // pass, announced to the table as system messages and dice cards.
  for (const characterId of next.pcsPassed) {
    rollDeathSave(campaign, characterId);
  }
  return { enemiesPassed: next.enemiesPassed };
}

// The auto-act fallback: enemies the model skipped this turn take their
// default attack anyway, so an enemy turn can never silently vanish. Runs
// through handleEnemyAttack, so multiattack, auto-approach, conditions, and
// real dice cards all apply; the outcome posts as a system table note the
// model narrates around next turn.
function autoActSkippedEnemies(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemyIds: string[],
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
) {
  const notes: string[] = [];
  for (const enemyId of enemyIds) {
    if (turn.actedEnemyIds.includes(enemyId)) {
      continue;
    }
    const enemy = resolveEnemyRef(encounter.id, enemyId);
    if (!enemy || enemy.status !== "alive" || isIncapacitated(enemy.conditions)) {
      continue;
    }
    const living = sheets.filter((sheet) => {
      const fresh = getSheetById(sheet.id);
      return (fresh?.currentHp ?? 0) > 0;
    });
    if (!living.length) {
      break;
    }
    const map = getBattleMapForEncounter(encounter.id);
    const attackerToken = map ? getTokenByRef(map.id, enemy.id) : null;
    const targetId = pickEnemyTarget(
      attackerToken ? { x: attackerToken.x, y: attackerToken.y } : null,
      living.map((sheet) => {
        const token = map ? getTokenByRef(map.id, sheet.id) : null;
        return {
          characterId: sheet.id,
          ac: sheet.ac,
          position: token ? { x: token.x, y: token.y } : null,
        };
      }),
    );
    if (!targetId) {
      break;
    }
    const result = handleEnemyAttack(
      campaign,
      turn,
      JSON.stringify({ enemyId: enemy.id, targetCharacterId: targetId }),
      sheets,
      sheetsById,
    );
    const targetName = sheetsById.get(targetId)?.name ?? "a hero";
    if ("error" in result) {
      // Out of reach or otherwise unable: the skipped turn passes quietly.
      continue;
    }
    const swings = Array.isArray(result.swings) ? (result.swings as Array<Record<string, unknown>>) : [];
    const summary = swings
      .map((swing) =>
        swing.hit
          ? `${swing.rolled} vs AC ${result.vsAc}: HIT for ${swing.damage}${swing.crit ? " (CRIT)" : ""}`
          : `${swing.rolled} vs AC ${result.vsAc}: miss`,
      )
      .join("; ");
    notes.push(
      `${enemy.displayName} attacks ${targetName} with ${String(result.attack)} (${summary}).${
        result.dropped ? ` ${targetName} falls!` : ""
      }`,
    );
  }
  if (notes.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      content: `Skipped enemy turns resolve automatically: ${notes.join(" ")}`,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
    saveDmTurn(turn);
  }
}

// Called from finalize() on a successful DM turn: the pointer moves only
// when the current PC actually acted (a player message from them landed
// after the pointer reached them), so combat-opening turns and table talk
// never steal anyone's turn. Enemies the pointer passes that the model
// never attacked with auto-act via the server fallback.
export function advanceAfterTurn(campaign: Campaign, turn?: DmTurn) {
  const floor = getFloor(campaign.id);
  if (floor.mode !== "initiative") {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady || encounter.id !== floor.encounterId) {
    return;
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current || current.kind !== "pc") {
    return;
  }
  const acted = listRecentMessages(campaign.id, 30).some(
    (message) =>
      message.authorType === "player" &&
      message.userId === current.userId &&
      message.seq > encounter.waitingSeq &&
      !message.content.startsWith("(ooc)"),
  );
  if (!acted) {
    return;
  }
  const advanced = advancePointer(campaign, encounter);
  if (advanced && turn) {
    const sheets = listSheets(campaign.id);
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    autoActSkippedEnemies(
      campaign,
      turn,
      encounter,
      advanced.enemiesPassed,
      sheets,
      sheetsById,
    );
  }
}

// Lead escape hatch: advance past an absent player's turn. Inserts a table
// note; the caller wakes the DM so intervening enemies still act (kept out
// of this module to avoid an import cycle with the turn loop).
export function skipCurrentTurn(campaignId: string): boolean {
  const campaign = getCampaignById(campaignId);
  const encounter = getActiveEncounter(campaignId);
  if (!campaign || !encounter || !encounter.orderReady) {
    return false;
  }
  const skipped = encounter.order[encounter.turnIndex];
  if (!advancePointer(campaign, encounter)) {
    return false;
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `The party lead skipped ${skipped?.name ?? "the current"}'s turn.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  return true;
}
