import type { Campaign } from "@/lib/db/campaigns";
import { saveDamageTaken } from "@/lib/srd/trait-rules";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { enemyHpCap } from "@/lib/dm/monster-abilities";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { allocateSeq } from "@/lib/db/campaigns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { isValidExpression, rollExpression, type RollResult } from "@/lib/dice";
import { sizeRank, type EnemyAttack, type TypedDice } from "@/lib/bestiary/statblock";
import { damageAdjust, durationArgsFor, effectiveMaxHp, maxHpRiders, pcResistances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { damageParts } from "@/lib/dm/damage-parts";
import { immersedResistance } from "@/lib/dm/underwater";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { applyDmMutation } from "@/lib/dm/mutations";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// What an enemy's hit does once it lands (SRD 5.1): each damage type in the
// blow meets the target's resistances on its own ("piercing plus fire"
// halves only the fire for a tiefling), and the rider the attack prints
// (a Strength save or be knocked prone, poison halved on a save, a grapple
// with its escape DC) is resolved by the engine, not left to the model.

type Sheets = { sheets: CharacterSheet[]; sheetsById: Map<string, CharacterSheet> };

// The typed riders of an attack stored before riders were: a block parsed
// or written as "2d10+2d6+8", "piercing/fire" rolls its own dice first and
// each later type's dice after, in order, so the later types are read back
// off the later dice terms. None when the terms and types do not line up.
export function legacyRiders(attack: Pick<EnemyAttack, "damage" | "type">): TypedDice[] {
  const types = attack.type.split("/").map((type) => type.trim().toLowerCase()).filter(Boolean);
  if (types.length < 2) {
    return [];
  }
  const dice = attack.damage
    .replace(/\s+/g, "")
    .split(/(?=[+-])/)
    .map((term) => term.replace(/^\+/, ""))
    .filter((term) => /^\d+d\d+$/i.test(term));
  if (dice.length !== types.length) {
    return [];
  }
  return types.slice(1).map((type, index) => ({ dice: dice[index + 1], type }));
}

// The blow's damage by type, each part met by the target's resistances. The
// attack rolled one expression; the typed riders are read back out of it.
export function blowByType(
  attack: EnemyAttack,
  outcome: RollResult,
  target: CharacterSheet,
  crit: boolean,
  // Magic Weapons: the blow is magical, so nonmagical-only resistance fails.
  magical = false,
): { amount: number; type: string | undefined; byType: string[] | null } {
  const mainType = attack.type.split("/")[0] || undefined;
  const rolled = Math.max(0, outcome.total);
  const riders = attack.riders?.length ? attack.riders : legacyRiders(attack);
  if (!riders.length || !mainType) {
    // One type, read as its first word: "piercing/fire" never lands whole
    // as whichever type a resistance line happens to name.
    return { amount: rolled, type: mainType ?? attack.type, byType: null };
  }
  const parts = damageParts(outcome, mainType, riders, { crit });
  if (parts.length < 2) {
    return { amount: rolled, type: mainType, byType: null };
  }
  // Fully immersed in water: resistance to fire (underwater.ts).
  const resist = [pcResistances(target, { magical }), immersedResistance(target.campaignId, target.id)].filter(Boolean).join(", ");
  const adjusted = parts.map((part) => ({ ...part, ...damageAdjust(part.amount, part.type, resist, "", "", { magical }) }));
  return {
    amount: adjusted.reduce((sum, part) => sum + part.amount, 0),
    // Already met part by part: the total lands untyped so nothing halves
    // it twice.
    type: undefined,
    byType: adjusted.map((part) => `${part.amount} ${part.type}${part.note ? ` (${part.note})` : ""}`),
  };
}

const SMALL_RACES = ["halfling", "gnome", "goblin", "kobold"];

// A character's size for a rider's size limit: the small races are Small,
// everyone else Medium (ODM keeps no size on the sheet).
function characterSize(sheet: CharacterSheet): string {
  return SMALL_RACES.some((race) => sheet.race.toLowerCase().includes(race)) ? "small" : "medium";
}

// The rider a hit carries, resolved: the target's full save (conditions,
// auras, Brave against fear, a dwarf against poison), the rider's damage
// halved or not, and the condition set with the enemy as its source, so it
// ends when the enemy does. Returns what to report, or null when the hit
// carries none.
export function resolveOnHit(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  attack: EnemyAttack,
  targetId: string,
  // What the hit itself dealt, all of it and its necrotic part, for a
  // drain of the maximum (Life Drain, a vampire's bite).
  { sheets, sheetsById, dealt }: Sheets & { dealt?: { total: number; necrotic: number } },
): Record<string, unknown> | null {
  const rider = attack.onHit;
  const target = getSheetById(targetId);
  if (!rider || !target || target.currentHp <= 0 || target.deathSaves?.dead) {
    return null;
  }
  if (rider.maxSize && sizeRank(characterSize(target)) > sizeRank(rider.maxSize)) {
    return { rider: `${target.name} is too large for ${attack.name}'s rider.` };
  }
  const out: Record<string, unknown> = {};
  let saved = false;
  if (rider.save && rider.dc) {
    const save = rollCharacterSave(
      campaign,
      turn,
      target,
      rider.save,
      rider.dc,
      `${target.name}: ${rider.save.toUpperCase()} save vs ${enemy.displayName}'s ${attack.name}`,
      rider.condition ?? rider.damageType,
    );
    saved = save.success;
    out.riderSave = save.total === null ? "failed automatically" : `${save.total} vs DC ${rider.dc}`;
    out.riderSaved = saved;
  }
  if (rider.damage && isValidExpression(rider.damage)) {
    const outcome = rollExpression(rider.damage);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(`${attack.name} (${rider.damageType ?? "rider"})`, target.name),
      result: outcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
    turn.rollIds.push(roll.id);
    const taken = saveDamageTaken({ total: outcome.total, saved, halfOnSave: Boolean(rider.halfOnSave), ability: rider.save ?? "", sheet: target });
    const dealt = rider.save && rider.dc ? taken.damage : outcome.total;
    if (taken.evasion && rider.save && rider.dc) {
      out.evasion = taken.evasion;
    }
    if (dealt > 0) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: target.id,
          amount: dealt,
          type: rider.damageType,
          reason: `${enemy.displayName}'s ${attack.name} (${rider.damageType ?? "rider"})`,
        }),
        sheets,
        sheetsById,
      ).result;
      out.riderDamage = dealt;
      if (typeof applied.hp === "string") {
        out.targetHp = applied.hp;
      }
    } else {
      out.riderDamage = 0;
    }
  }
  const conditions = rider.condition && !saved ? [rider.condition, ...(rider.alsoCondition ? [rider.alsoCondition] : [])] : [];
  const standing = getSheetById(target.id);
  for (const condition of conditions) {
    if (!standing || (standing.currentHp <= 0 && condition === "prone")) {
      continue;
    }
    // The rider's own words for how long it lasts: a count (an hour of
    // poison is 600 rounds), a repeat save, or a long rest
    // (src/lib/dm/monster-abilities.ts parseSaveEffect).
    const applied = rider.untilLongRest
      ? handleSetCondition(campaign, turn.id, getSheetById(target.id) ?? target, { condition, sourceEnemyId: enemy.id }, `${enemy.displayName}'s ${attack.name}`, {
          spellEffect: { source: enemy.id, untilLongRest: true },
        })
      : applyDmMutation(
          campaign,
          turn.id,
          "set_condition",
          JSON.stringify({
            characterId: target.id,
            condition,
            sourceEnemyId: enemy.id,
            ...(rider.rounds ? durationArgsFor(rider.rounds) : {}),
            ...(rider.repeatSave && rider.save && rider.dc ? { saveAbility: rider.save, saveDc: rider.dc } : {}),
            reason: `${enemy.displayName}'s ${attack.name}`,
          }),
          sheets,
          sheetsById,
        ).result;
    if (!("error" in applied)) {
      out.riderCondition = [...((out.riderCondition as string[] | undefined) ?? []), condition];
    }
  }
  if (rider.escapeDc && ((out.riderCondition as string[] | undefined) ?? []).includes("grappled")) {
    out.escapeDc = rider.escapeDc;
    // The printed escape DC is what the escape is rolled against
    // (grapple.ts characterEscape), so it is kept on the condition.
    const held = getSheetById(target.id);
    const key = Object.keys(held?.conditionMeta ?? {}).find((name) => name.toLowerCase() === "grappled") ?? "grappled";
    if (held) {
      const meta = { ...(held.conditionMeta as ConditionMetaMap) };
      meta[key] = { ...meta[key], source: enemy.id, escapeDc: rider.escapeDc };
      const updated = patchSheet(held.id, { conditionMeta: meta });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  // Life Drain: the maximum falls by what the hit dealt until a long rest,
  // and a creature brought to a maximum of 0 dies (condition-logic.ts
  // maxHpRiders keeps the drain on the sheet).
  if (rider.drainMaxHp && !saved) {
    const amount = rider.drainMaxHp === "necrotic" ? (dealt?.necrotic ?? 0) : (dealt?.total ?? 0);
    const drained = amount > 0 ? drainMaxHp(campaign, target.id, enemy.id, amount) : null;
    if (drained) {
      out.maxHpDrained = drained;
      if (rider.drainHeals) {
        const now = getEnemy(enemy.id);
        if (now && now.status === "alive") {
          const healed = Math.min(enemyHpCap(now), now.currentHp + amount);
          patchEnemyHp(now.id, healed, "alive");
          out.drainHealed = `${enemy.displayName} regains ${healed - now.currentHp} hit points.`;
        }
      }
    }
  }
  // Swallowed whole: blinded and restrained, with the creature as source.
  if (rider.swallow && !saved && (!rider.maxSize || sizeRank(characterSize(target)) <= sizeRank(rider.maxSize))) {
    for (const condition of ["blinded", "restrained"]) {
      const applied = handleSetCondition(campaign, turn.id, getSheetById(target.id) ?? target, { condition, sourceEnemyId: enemy.id }, `swallowed by ${enemy.displayName}`, {
        spellEffect: { source: enemy.id },
      });
      if (!("error" in applied)) {
        out.riderCondition = [...((out.riderCondition as string[] | undefined) ?? []), condition];
      }
    }
    out.swallowed = `${target.name} is swallowed: blinded and restrained inside ${enemy.displayName}, with total cover from everything outside it. Its stomach's damage each turn and the way out are the DM's to resolve from the block.`;
  }
  if (rider.manual?.length) {
    out.manual = `The server does not model this part of ${attack.name}; resolve it by hand: ${rider.manual.join(" ")}`;
  }
  return Object.keys(out).length ? out : null;
}

// Lowers a character's hit point maximum by `amount` until a long rest, all
// drains folded into one line; a maximum brought to 0 kills.
function drainMaxHp(campaign: Campaign, targetId: string, sourceId: string, amount: number): string | null {
  const sheet = getSheetById(targetId);
  if (!sheet || sheet.deathSaves?.dead) {
    return null;
  }
  const meta = { ...(sheet.conditionMeta as ConditionMetaMap) };
  const before = maxHpRiders(sheet.conditions, meta).drain;
  const kept = sheet.conditions.filter((name) => !/^max hp reduced \(-\d+\)$/i.test(name.trim()));
  for (const name of sheet.conditions.filter((entry) => !kept.includes(entry))) {
    delete meta[name];
  }
  const name = `max hp reduced (-${before + amount})`;
  const updated = patchSheet(sheet.id, { conditions: [...kept, name], conditionMeta: { ...meta, [name]: { source: sourceId, untilLongRest: true } } });
  if (!updated) {
    return null;
  }
  if (effectiveMaxHp(updated) <= 0) {
    const dead = patchSheet(updated.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    publishPersisted(campaign.id, "sheet_updated", { sheet: dead ?? updated });
    return `${updated.name}'s hit point maximum falls to 0: they die.`;
  }
  publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  return `${updated.name}'s hit point maximum is reduced by ${amount} (now ${effectiveMaxHp(updated)}) until they finish a long rest.`;
}
