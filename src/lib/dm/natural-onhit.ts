// What a creature's natural attack does to an enemy past its damage, once
// the hit has landed (SRD 5.1): the save its stat block prints, rolled as
// every enemy save is (src/lib/dm/forced-save.ts); the damage failing it
// costs, halved on a success where the block says so; the condition it lays
// with its duration and its save at the end of each turn; the unconscious
// a pseudodragon's or a sprite's poison adds on a bad enough save; a
// grapple held by the attacker at the block's escape DC; and every sentence
// no engine models, named to the DM. Shared by pc_attack (a beast form, a
// summoned creature, src/lib/dm/pc-attack-resolve.ts and its physical-dice
// path) and pet_attack (src/lib/dm/pet-tools.ts).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { sizeRank } from "@/lib/bestiary/statblock";
import { isIncapacitated, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { settleEnemyIncapacitation } from "@/lib/dm/enemy-incapacitation";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { rollAgainst } from "@/lib/roll-labels";
import { onHitWords, type CreatureOnHit } from "@/lib/srd/creature-attacks";

export type NaturalHit = {
  turn: DmTurn;
  // Who rolled it, for the roll cards, and the sheet that holds a grapple
  // it makes (the beast-shaped druid, the summoned creature); null when no
  // sheet can hold one (a pet on its owner's sheet).
  attacker: { kind: "sheet" | "pet"; sheetId: string; name: string };
  holderId: string | null;
  attack: string;
  enemyId: string;
  onHit: CreatureOnHit;
};

// "undead" in "undead" or "humanoid (elf)" in "elf": a word of the
// creature's type line.
function typeHolds(enemy: EncounterEnemy, word: string): boolean {
  return (enemy.stats.type ?? "").toLowerCase().split(/[^a-z]+/).includes(word.toLowerCase());
}

// The rider resolved on the enemy; the lines say what happened.
export function landNaturalOnHit(campaign: Campaign, hit: NaturalHit): string[] {
  const { onHit } = hit;
  const enemy = getEnemy(hit.enemyId);
  if (!enemy || enemy.status !== "alive") {
    return [];
  }
  const label = hit.attack;
  const lines: string[] = [];
  const spared = onHit.exempt?.find((word) => typeHolds(enemy, word));
  if (spared) {
    return [`${label}: ${enemy.displayName} is ${spared === "undead" ? "undead" : `a ${spared}`}, which this rider spares (${onHitWords(onHit)}).`];
  }
  let saved = false;
  let failedBy = 0;
  let total: number | null = null;
  if (onHit.save && onHit.dc) {
    const save = rollEnemySave(campaign.id, enemy, onHit.save, onHit.dc, {
      record: { turn: hit.turn, detail: `${enemy.displayName}: ${onHit.save.toUpperCase()} save vs ${label}` },
      // A rider that binds the creature asks for its Legendary Resistance.
      resist: Boolean(onHit.condition),
      against: onHit.condition,
    });
    saved = save.success;
    total = save.total;
    failedBy = save.autoFailed ? 99 : onHit.dc - (save.total ?? 0);
    lines.push(`${label}: ${enemy.displayName} ${saved ? "makes" : "fails"} the ${onHit.save.toUpperCase()} save (${save.autoFailed ? "automatic failure" : `${save.total} vs DC ${onHit.dc}`})`);
  }
  if (onHit.damage && (!saved || onHit.halfOnSave)) {
    const outcome = rollExpression(onHit.damage);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: hit.attacker.sheetId,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${label} (${onHit.damageType ?? "rider"})`, enemy.displayName),
      result: outcome,
      attacker: { kind: hit.attacker.kind, id: hit.attacker.sheetId, name: hit.attacker.name },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
    hit.turn.rollIds.push(roll.id);
    const dealt = saved ? Math.floor(outcome.total / 2) : outcome.total;
    const encounter = getActiveEncounter(campaign.id);
    if (encounter && dealt > 0) {
      const sheets = listSheets(campaign.id);
      const applied = applyEnemyDamage(campaign, hit.turn, encounter, enemy, dealt, sheets, new Map(sheets.map((entry) => [entry.id, entry])), onHit.damageType);
      const landed = "damageApplied" in applied && typeof applied.damageApplied === "number" ? applied.damageApplied : dealt;
      lines.push(`${label}: ${landed} ${onHit.damageType ?? ""} damage${saved ? " (half, on the save)" : ""}`.replace(/\s+damage/, " damage"));
    }
  }
  if (!saved) {
    lines.push(...layConditions(campaign, hit, failedBy, total));
  }
  if (onHit.drainMaxHp && !saved) {
    lines.push(`${label}: ${enemy.displayName}'s hit point maximum is reduced by the damage taken until it finishes a long rest; the GM keeps that count.`);
  }
  if (onHit.manual?.length) {
    lines.push(`${label}, for the GM to resolve: ${onHit.manual.join(" ")}`);
  }
  return lines;
}

// The conditions a failed save (or a hit with no save) lays: the rider's
// own, unconscious too on a bad enough save, and a grapple held by the
// attacker with the block's escape DC and the restraint it brings.
function layConditions(campaign: Campaign, hit: NaturalHit, failedBy: number, total: number | null): string[] {
  const { onHit } = hit;
  const fresh = getEnemy(hit.enemyId);
  if (!fresh || fresh.status !== "alive" || !onHit.condition) {
    return [];
  }
  if (onHit.maxSize && sizeRank(fresh.stats.size) > sizeRank(onHit.maxSize)) {
    return [`${hit.attack}: ${fresh.displayName} is ${fresh.stats.size}, too large to be ${onHit.condition} by it (${onHit.maxSize} or smaller).`];
  }
  const grapple = onHit.condition === "grappled";
  if (grapple && !hit.holderId) {
    return [`${hit.attack}: the hit grapples ${fresh.displayName} (escape DC ${onHit.escapeDc})${onHit.alsoCondition ? ` and it is ${onHit.alsoCondition} until the grapple ends` : ""}; the GM keeps the hold, as no sheet of its own can.`];
  }
  const unconscious =
    (onHit.unconsciousFailBy !== undefined && failedBy >= onHit.unconsciousFailBy) ||
    (onHit.unconsciousAtMost !== undefined && (total === null || total <= onHit.unconsciousAtMost));
  const wanted = [onHit.condition, ...(onHit.alsoCondition ? [onHit.alsoCondition] : []), ...(unconscious ? ["unconscious"] : [])];
  // Its own immunities, and a petrified creature's to poison.
  const laid = wanted.filter((name) => !immuneToCondition(fresh, name) && !fresh.conditions.includes(name));
  const skipped = wanted.filter((name) => immuneToCondition(fresh, name));
  const meta: ConditionMetaMap = { ...(fresh.conditionMeta as ConditionMetaMap) };
  for (const name of laid) {
    const entry: ConditionMeta = {
      ...(onHit.rounds && !grapple ? { rounds: onHit.rounds } : {}),
      ...(hit.holderId ? { source: hit.holderId } : {}),
      ...(onHit.repeatSave && onHit.save && onHit.dc && name === onHit.condition ? { saveEnds: { ability: onHit.save, dc: onHit.dc } } : {}),
      ...(name === "grappled" && onHit.escapeDc ? { escapeDc: onHit.escapeDc } : {}),
      // Asleep from a bad save on the poison: damage or a shake wakes it.
      ...(name === "unconscious" && unconscious && onHit.alsoCondition !== "unconscious" ? { endsOnDamage: true } : {}),
    };
    meta[name] = entry;
  }
  const lines: string[] = [];
  if (laid.length) {
    const conditions = [...fresh.conditions, ...laid];
    patchEnemyConditions(fresh.id, conditions, meta);
    settleEnemyIncapacitation(fresh.id, isIncapacitated(conditions));
    publishEncounter(campaign.id);
    const lasting = grapple ? ` (escape DC ${onHit.escapeDc}, until the grapple ends)` : onHit.repeatSave ? " (it saves again at the end of each of its turns)" : "";
    lines.push(`${hit.attack}: ${fresh.displayName} is ${laid.join(" and ")}${lasting}`);
  }
  if (skipped.length) {
    lines.push(`${hit.attack}: ${fresh.displayName} is immune to being ${skipped.join(" or ")}`);
  }
  return lines;
}
