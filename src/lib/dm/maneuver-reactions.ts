// The Battle Master maneuvers taken with a reaction or after another call
// (issue 233, src/lib/dm/maneuver-rules.ts). Before this use_reaction spent
// the reaction for a "Parry" and kept the Superiority Die, and nothing
// carried a Maneuvering Attack's move, a Commander's Strike or the grapple
// after a Grappling Strike.
//
//   Parry (PHB): "When another creature damages you with a melee attack, you
//     can use your reaction and expend one superiority die to reduce the
//     damage by the number you roll on your superiority die + your Dexterity
//     modifier."
//   Riposte (PHB): "When a creature misses you with a melee attack ... make a
//     melee weapon attack against the creature", the die on its damage.
//   Brace (TCoE): "When a creature you can see moves into the reach you have
//     with the melee weapon you're wielding ... make one attack against the
//     creature", the die on its damage.
//   Maneuvering Attack: the ally the fighter's hit opened moves up to half
//     its speed with its own reaction, drawing no opportunity attack from the
//     target.
//   Commander's Strike: the ally the fighter directed attacks with its
//     reaction, the die on that attack's damage.
//
// Called from use_reaction (src/lib/dm/reaction-tools.ts) and take_action
// (src/lib/dm/action-tools.ts). The die is spent through use_resource, which
// charges nothing for a plain spend.

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { addSheetCondition } from "@/lib/dm/action-common";
import { removeConditions } from "@/lib/dm/condition-logic";
import { attackerFoeId, freshLastHit, writeLastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { COMMANDED, GRAPPLING_STRIKE, MANEUVERED, SUPERIORITY_STRIKE, maneuverDieFor, markedDie, maneuverUse } from "@/lib/dm/maneuver-rules";
import { applyDmMutation } from "@/lib/dm/mutations";
import { READIED } from "@/lib/dm/object-actions";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { rollCard } from "@/lib/dm/roll-card";
import { reactionMove } from "@/lib/dm/authored-reactions-more";
import { noHit, settle, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";

// Whether the sheet knows this maneuver ("Maneuver: Parry").
function knows(sheet: CharacterSheet, name: string): boolean {
  return sheet.features.some((feature) => /^maneuver:/i.test(feature.name) && isNamed(feature.name, name));
}

// The sheet's own mark, by its name with or without its die ("grappling
// strike (1d8)").
function markOf(sheet: CharacterSheet, name: string): string | null {
  return sheet.conditions.find((entry) => isConditionNamed(entry, name)) ?? null;
}

function clearMarks(campaign: Campaign, sheetId: string, names: string[]) {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const gone = sheet.conditions.filter((entry) => names.some((name) => isConditionNamed(entry, name)));
  if (!gone.length) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, gone);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// One Superiority Die spent, or the refusal.
function payDie(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  label: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolError | null {
  const spent = applyDmMutation(
    campaign,
    turnId,
    "use_resource",
    JSON.stringify({ characterId: sheet.id, resource: "Superiority Dice", reason: label }),
    sheets,
    sheetsById,
  ).result;
  return typeof spent.error === "string" ? { ...toolError(spent), error: `${label}: ${spent.error}` } : null;
}

// ---- use_reaction ----

export function maneuverReaction(ctx: Ctx): Record<string, unknown> | null {
  const name = ctx.args.feature;
  if (isNamed(name, "Maneuvering Attack")) {
    return maneuveredMove(ctx);
  }
  if (isNamed(name, "Commander's Strike")) {
    return commandedAttack(ctx);
  }
  if (maneuverUse(name) !== "reaction") {
    return null;
  }
  const which = ["parry", "riposte", "brace"].find((entry) => isNamed(name, entry));
  if (!which || !knows(ctx.sheet, which)) {
    return null;
  }
  return which === "parry" ? parry(ctx) : reactionStrike(ctx, which === "riposte" ? "Riposte" : "Brace");
}

function parry(ctx: Ctx): ToolResult {
  const { campaign, sheet } = ctx;
  const record = freshLastHit(campaign.id, sheet.id);
  const index = record && record.source === "attack" && !record.ranged && attackerFoeId(record) !== null && !record.answered.includes("parry")
    ? heaviest(record.swings)
    : -1;
  if (!record || index < 0) {
    return noHit(sheet.name, "Parry", "damage from a melee attack");
  }
  const refused = payDie(campaign, ctx.turn.id, sheet, "Parry", ctx.sheets, ctx.sheetsById);
  if (refused) {
    return { ...refused, error: `${refused.error} Nothing was spent.` };
  }
  spendReaction(ctx);
  const dex = computeSheetDerived(sheet).abilityMods.dex;
  const expression = `1${maneuverDieFor(sheet)}${dex >= 0 ? "+" : ""}${dex}`;
  const rolled = Math.max(0, rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: Parry`, expression, null).total);
  const corrected = record.swings.map((swing, at) => (at === index ? { ...swing, raw: Math.max(0, swing.raw - rolled) } : swing));
  const settled = settle(ctx, record, corrected, "parry");
  return {
    ok: true,
    reaction: "Parry",
    rolled: `${expression}: ${rolled}`,
    applied: `The blow is reduced by ${rolled}: ${settled.given} hit points come back. HP ${settled.hp}.`,
    spent: `One Superiority Die and ${sheet.name}'s reaction.`,
  };
}

function heaviest(swings: SwingRecord[]): number {
  return swings.reduce((best, swing, at) => (swing.hit && swing.raw > 0 && (best < 0 || swing.raw > swings[best].raw) ? at : best), -1);
}

// Riposte and Brace: one melee attack with the reaction, the die on its hit.
function reactionStrike(ctx: Ctx, label: "Riposte" | "Brace"): ToolResult {
  const { campaign, sheet } = ctx;
  let enemyId = ctx.args.targetEnemyId ?? null;
  if (label === "Riposte") {
    const record = freshLastHit(campaign.id, sheet.id);
    const missed = record && record.source === "attack" && !record.ranged && attackerFoeId(record) !== null && record.attacker.id
      && !record.answered.includes("riposte") && record.swings.some((swing) => !swing.hit);
    if (!record || !missed) {
      return noHit(sheet.name, "Riposte", "a melee attack that missed them");
    }
    enemyId = record.attacker.id;
    writeLastHit(campaign.id, { ...record, answered: [...record.answered, "riposte"] });
  }
  if (!enemyId) {
    return { error: "Brace answers a creature moving into the fighter's reach: pass its targetEnemyId. Nothing was spent.", retry: true };
  }
  const before = getSheetById(sheet.id)?.resources;
  const refused = payDie(campaign, ctx.turn.id, sheet, label, ctx.sheets, ctx.sheetsById);
  if (refused) {
    return { ...refused, error: `${refused.error} Nothing was spent.` };
  }
  const outcome = reactionAttack(ctx, sheet, enemyId, `${SUPERIORITY_STRIKE} (1${maneuverDieFor(sheet)})`, label);
  if ("error" in outcome) {
    // The attack never happened: the die comes back.
    const updated = before ? patchSheet(sheet.id, { resources: before }) : null;
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    return outcome;
  }
  return { ok: true, reaction: label, spent: `One Superiority Die and ${sheet.name}'s reaction.`, attack: outcome };
}

// One weapon attack off the attacker's turn with their reaction: the readied
// mark lets pc_attack through and the attack spends it and the reaction.
// `strike`: the die riding its hit, set first when the attacker is the one
// paying (Riposte, Brace); already on the ally for Commander's Strike.
function reactionAttack(ctx: Ctx, attacker: CharacterSheet, enemyId: string, strike: string | null, label: string): ToolResult {
  const { campaign } = ctx;
  if (strike) {
    addSheetCondition(campaign, getSheetById(attacker.id) ?? attacker, strike, { untilTurnOf: attacker.id }, label);
  }
  addSheetCondition(campaign, getSheetById(attacker.id) ?? attacker, READIED, { untilTurnOf: attacker.id }, label);
  const result = handlePcAttack(
    campaign,
    ctx.turn,
    JSON.stringify({ characterId: attacker.id, targetEnemyId: enemyId }),
    ctx.sheets,
    ctx.sheetsById,
    new Set(),
    null,
  );
  // What the attack did not use goes: the readied mark, and the die on a miss.
  clearMarks(campaign, attacker.id, [READIED, SUPERIORITY_STRIKE]);
  return typeof result.error === "string" ? toolError(result) : result;
}

// Maneuvering Attack: the ally moves with its reaction.
function maneuveredMove(ctx: Ctx): ToolResult {
  const { campaign, sheet } = ctx;
  const opener = listSheets(campaign.id)
    .map((entry) => getSheetById(entry.id) ?? entry)
    .find((entry) => entry.id !== sheet.id && markOf(entry, MANEUVERED));
  if (!opener) {
    return { error: `Maneuvering Attack moves an ally right after a Battle Master's hit with it this turn, and none has landed. Nothing was spent.`, refused: "rules" };
  }
  const moved = reactionMove(ctx, "Maneuvering Attack", "opened");
  if ("error" in moved) {
    return moved;
  }
  const target = (opener.conditionMeta as Record<string, { source?: string } | undefined>)[markOf(opener, MANEUVERED) ?? ""]?.source;
  const enemy = target ? getEnemy(target) : null;
  spendReaction(ctx);
  clearMarks(campaign, opener.id, [MANEUVERED]);
  return {
    ok: true,
    reaction: "Maneuvering Attack",
    ...moved,
    note: `${opener.name}'s maneuver: ${sheet.name} moves without drawing an opportunity attack${enemy ? ` from ${enemy.displayName}` : ""}.`,
    spent: `${sheet.name}'s reaction.`,
  };
}

// Commander's Strike: the ally the fighter directed attacks.
function commandedAttack(ctx: Ctx): ToolResult {
  const { campaign, sheet } = ctx;
  if (!markOf(sheet, COMMANDED)) {
    return {
      error: `${sheet.name} has not been directed by a Commander's Strike this turn: the Battle Master spends it first (use_resource "Superiority Dice", variant "commander's strike", with this character as targetCharacterId). Nothing was spent.`,
      retry: true,
    };
  }
  if (!ctx.args.targetEnemyId) {
    return { error: "Commander's Strike is one weapon attack: pass the targetEnemyId. Nothing was spent.", retry: true };
  }
  const outcome = reactionAttack(ctx, sheet, ctx.args.targetEnemyId, null, "Commander's Strike");
  if ("error" in outcome) {
    return outcome;
  }
  clearMarks(campaign, sheet.id, [COMMANDED, SUPERIORITY_STRIKE]);
  return { ok: true, reaction: "Commander's Strike", spent: `${sheet.name}'s reaction.`, attack: outcome };
}

// ---- take_action: the grapple after a Grappling Strike hit ----

// The die the hit left for the grapple, when there is one.
export function grapplingStrikeDie(sheet: CharacterSheet): string | null {
  const mark = markOf(sheet, GRAPPLING_STRIKE);
  return mark ? markedDie(mark) : null;
}

// The grapple's die paid and the mark spent, or the refusal. The grapple is
// at the creature the hit landed on.
export function payGrapplingStrike(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  targetEnemyId: string | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { die: string } | ToolError {
  const mark = markOf(sheet, GRAPPLING_STRIKE);
  const die = mark ? markedDie(mark) : null;
  if (!mark || !die) {
    return { error: `${sheet.name} has no Grappling Strike hit this turn to grapple after. Nothing was spent.`, refused: "rules" };
  }
  const struck = (sheet.conditionMeta as Record<string, { source?: string } | undefined>)[mark]?.source;
  if (struck && targetEnemyId && struck !== targetEnemyId) {
    const enemy = getEnemy(struck);
    return { error: `Grappling Strike grapples the creature the hit landed on${enemy ? ` (${enemy.displayName})` : ""}. Nothing was spent.`, retry: true };
  }
  const refused = payDie(campaign, turnId, sheet, "Grappling Strike", sheets, sheetsById);
  if (refused) {
    return { ...refused, error: `${refused.error} Nothing was spent.` };
  }
  clearMarks(campaign, sheet.id, [GRAPPLING_STRIKE]);
  return { die };
}
