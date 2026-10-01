// Turning a re-resolved attack back into state. A reaction (Shield, Uncanny
// Dodge, Deflect Missiles, Cutting Words, Protection, Slow Fall, Feather
// Fall) corrects the swings of the last attack against a character
// (src/lib/dm/last-hit.ts); this module works out what the character should
// have taken and puts them there.
//
// The corrected damage is replayed on the character as they stood before
// the attack: temporary hit points first, a beast form's pool before the
// druid's own, resistance as the damage path applies it. When nothing else
// has touched them since the attack, their hit points become exactly the
// replayed ones, and what the undone part of the blow set off is undone too:
// the drop to 0 (unconscious, prone, the death track, a death by massive
// damage), the rage it ended, the Relentless Endurance it spent, and the
// concentration it broke with the effects that spell held. When something
// has, the difference is healed through the heal path instead.
//
// This module must not import mutations.ts' callers back; it calls the heal
// mutation the same way cast-tools does.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { RAGING } from "@/lib/srd/class-resources";
import { concentrationDamageHook } from "@/lib/dm/concentration";
import { effectiveMaxHp, pcResistances, removeConditions } from "@/lib/dm/condition-logic";
import { damageAdjust } from "@/lib/dm/damage-logic";
import { isMassiveDamage } from "@/lib/dm/death-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { writeLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { applyDamageMath, wildShapeDamageMath } from "@/lib/dm/mutation-math";
import { applyDmMutation } from "@/lib/dm/mutations";
import { PRONE } from "@/lib/dm/vitals-logic";

const UNCONSCIOUS = "unconscious";
const LETHARGY = "incapacitated";

function has(list: string[], name: string): boolean {
  return list.some((entry) => entry.toLowerCase() === name);
}

// Damage that reached the character from these swings, after resistance.
export function landedBy(record: LastHit, swings: SwingRecord[]): number {
  const sheet = getSheetById(record.characterId);
  const resist = sheet ? pcResistances({ ...sheet, conditions: record.before.conditions }) : "";
  return swings
    .filter((swing) => swing.hit)
    .reduce((sum, swing) => sum + damageAdjust(swing.raw, swing.type ?? record.type, resist, "", "").amount, 0);
}

type Replayed = {
  currentHp: number;
  tempHp: number;
  wildShape: CharacterSheet["wildShape"];
  overkill: number;
};

function replay(record: LastHit, landed: number): Replayed {
  const before = record.before;
  if (before.wildShape) {
    const shape = wildShapeDamageMath(before.wildShape.beastHp, before.tempHp, landed);
    if (!shape.reverted) {
      return {
        currentHp: before.currentHp,
        tempHp: shape.tempHp,
        wildShape: { ...before.wildShape, beastHp: shape.beastHp },
        overkill: 0,
      };
    }
    const math = applyDamageMath(before.currentHp, shape.tempHp, shape.carryover);
    return { currentHp: math.currentHp, tempHp: math.tempHp, wildShape: null, overkill: math.overkill };
  }
  const math = applyDamageMath(before.currentHp, before.tempHp, landed);
  return { currentHp: math.currentHp, tempHp: math.tempHp, wildShape: null, overkill: math.overkill };
}

// The concentration save this attack forced, if one was rolled.
function concentrationSaveTotal(campaignId: string, record: LastHit): number | null {
  const spell = record.before.concentratingOn;
  if (!spell) {
    return null;
  }
  const save = listRecentRolls(campaignId, 40)
    .filter(
      (roll) =>
        roll.characterId === record.characterId &&
        roll.kind === "saving_throw" &&
        roll.detail.startsWith("CON save to keep concentration") &&
        roll.createdAt >= record.startedAt,
    )
    .at(-1);
  return save ? save.total : null;
}

// Puts back the concentration the attack broke, with the conditions the
// spell held on every creature and without the lethargy Haste's end laid.
function restoreConcentration(campaign: Campaign, record: LastHit): string | null {
  const spell = record.before.concentratingOn;
  const held = record.before.held;
  if (!spell) {
    return null;
  }
  const patched = patchSheet(record.characterId, { concentratingOn: spell });
  if (patched) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: patched });
  }
  const encounter = getActiveEncounter(campaign.id);
  for (const holder of held?.holders ?? []) {
    const wanted = holder.conditions.filter((name) => held!.names.includes(name.toLowerCase()));
    if (holder.kind === "sheet") {
      const now = getSheetById(holder.id);
      if (!now) {
        continue;
      }
      const missing = wanted.filter((name) => !has(now.conditions, name.toLowerCase()));
      const lethargy = has(now.conditions, LETHARGY) && !has(holder.conditions, LETHARGY);
      if (!missing.length && !lethargy) {
        continue;
      }
      const base = lethargy ? removeConditions(now.conditions, now.conditionMeta, [LETHARGY]) : { conditions: now.conditions, meta: now.conditionMeta };
      const meta = { ...base.meta } as Record<string, unknown>;
      for (const name of missing) {
        meta[name] = holder.meta[name] ?? {};
      }
      const updated = patchSheet(holder.id, {
        conditions: [...base.conditions, ...missing],
        conditionMeta: meta as FullPatchSheetInput["conditionMeta"],
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    } else if (encounter) {
      const enemy = getEnemy(holder.id);
      if (!enemy || enemy.status !== "alive") {
        continue;
      }
      const missing = wanted.filter((name) => !has(enemy.conditions, name.toLowerCase()));
      const lethargy = has(enemy.conditions, LETHARGY) && !has(holder.conditions, LETHARGY);
      if (!missing.length && !lethargy) {
        continue;
      }
      const base = lethargy ? removeConditions(enemy.conditions, enemy.conditionMeta, [LETHARGY]) : { conditions: enemy.conditions, meta: enemy.conditionMeta };
      const meta = { ...base.meta } as Record<string, unknown>;
      for (const name of missing) {
        meta[name] = holder.meta[name] ?? {};
      }
      patchEnemyConditions(holder.id, [...base.conditions, ...missing], meta as typeof enemy.conditionMeta);
      publishEncounter(campaign.id);
    }
  }
  return spell;
}

export type Settled = {
  // Hit points (and temporary hit points) given back.
  given: number;
  hp: string;
  notes: string[];
};

// Applies corrected swings to the character the record is about, and keeps
// the corrected record so a second reaction starts from it. `label` names
// the reaction, which the record remembers as answered.
export function settleLastHit(
  campaign: Campaign,
  turnId: string,
  record: LastHit,
  corrected: SwingRecord[],
  label: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Settled {
  const sheet = getSheetById(record.characterId);
  const notes: string[] = [];
  if (!sheet) {
    return { given: 0, hp: "", notes };
  }
  const oldLanded = landedBy(record, record.swings);
  const newLanded = Math.min(oldLanded, landedBy(record, corrected));
  const keep = (after: LastHit["after"]) =>
    writeLastHit(campaign.id, { ...record, swings: corrected, after, answered: [...record.answered, label] });
  const maxHp = effectiveMaxHp(sheet);
  if (newLanded >= oldLanded) {
    keep(record.after);
    return { given: 0, hp: `${sheet.currentHp}/${maxHp}`, notes };
  }
  const untouched =
    sheet.currentHp === record.after.currentHp &&
    sheet.tempHp === record.after.tempHp &&
    (sheet.wildShape?.beastHp ?? null) === record.after.beastHp;
  if (!untouched) {
    // Something moved their hit points since the attack; give back the
    // difference through the heal path, which wakes a dying character.
    const give = oldLanded - newLanded;
    applyDmMutation(
      campaign,
      turnId,
      "heal",
      JSON.stringify({ characterId: sheet.id, amount: give, reason: label }),
      sheets,
      sheetsById,
    );
    const now = getSheetById(sheet.id) ?? sheet;
    keep({ currentHp: now.currentHp, tempHp: now.tempHp, beastHp: now.wildShape?.beastHp ?? null });
    return { given: give, hp: `${now.currentHp}/${maxHp}`, notes };
  }

  const before = record.before;
  const next = replay(record, newLanded);
  const patch: FullPatchSheetInput = {
    currentHp: next.currentHp,
    tempHp: next.tempHp,
    ...(before.wildShape ? { wildShape: next.wildShape } : {}),
  };
  const droppedByIt = before.currentHp > 0 && sheet.currentHp === 0;
  const relentlessSpent =
    before.relentless !== null &&
    (sheet.resources?.relentless_endurance?.used ?? 0) > before.relentless.used;
  let conditions = [...sheet.conditions];
  let meta = { ...sheet.conditionMeta } as Record<string, unknown>;
  if (next.currentHp > 0 && (droppedByIt || relentlessSpent || sheet.deathSaves?.dead)) {
    // The blow no longer drops them: the fall, the death track and what the
    // drop ended are undone.
    for (const name of [UNCONSCIOUS, PRONE]) {
      if (has(conditions, name) && !has(before.conditions, name)) {
        const cleared = removeConditions(conditions, meta as CharacterSheet["conditionMeta"], [name]);
        conditions = cleared.conditions;
        meta = cleared.meta as Record<string, unknown>;
      }
    }
    const rage = before.conditions.find((name) => name.toLowerCase() === RAGING);
    if (rage && !has(conditions, RAGING)) {
      conditions = [...conditions, rage];
      meta = { ...meta, [rage]: (before.conditionMeta as Record<string, unknown>)[rage] ?? {} };
      notes.push(`${sheet.name} is still raging.`);
    }
    patch.deathSaves = before.deathSaves ?? null;
    if (relentlessSpent && before.relentless) {
      patch.resources = { ...sheet.resources, relentless_endurance: { ...before.relentless } };
      notes.push("Relentless Endurance was never needed and is unspent.");
    }
  } else if (next.currentHp === 0 && relentlessSpent) {
    // Still a drop: Relentless Endurance still holds them at 1.
    patch.currentHp = 1;
  } else if (next.currentHp === 0 && sheet.deathSaves?.dead && !before.deathSaves?.dead) {
    // A death by massive damage the lighter blow no longer deals.
    if (!isMassiveDamage(next.overkill, maxHp)) {
      patch.deathSaves = { successes: 0, failures: 0, stable: false, dead: false };
      notes.push(`${sheet.name} is dying, not dead: the blow was no longer enough to kill outright.`);
    }
  }
  patch.conditions = conditions;
  patch.conditionMeta = meta as FullPatchSheetInput["conditionMeta"];
  const updated = patchSheet(sheet.id, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }

  // Concentration the attack broke: undone when the corrected blow would
  // not have broken it. A miss asks no save; a lighter hit asks it against
  // the lower DC, which the save already rolled is read against; a drop to
  // 0 that is undone asks the save now.
  if (before.concentratingOn && !getSheetById(sheet.id)?.concentratingOn) {
    const dc = Math.max(10, Math.floor(newLanded / 2));
    const rolled = concentrationSaveTotal(campaign.id, record);
    const wasDropped = droppedByIt && rolled === null;
    const heldNow = newLanded === 0 || (rolled !== null && rolled >= dc) || (wasDropped && next.currentHp > 0);
    if (heldNow && next.currentHp > 0) {
      const spell = restoreConcentration(campaign, record);
      if (spell) {
        notes.push(`${sheet.name} keeps concentrating on ${spell}.`);
        if (wasDropped && newLanded > 0) {
          const fresh = getSheetById(sheet.id);
          if (fresh) {
            const save = concentrationDamageHook(campaign, turnId, fresh, newLanded);
            if (save.concentrationBroken || (save.concentration as { held?: boolean } | undefined)?.held === false) {
              notes.push(`The lighter blow still asked a concentration save, and ${spell} ended.`);
            }
          }
        }
      }
    }
  }
  const now = getSheetById(sheet.id) ?? sheet;
  keep({ currentHp: now.currentHp, tempHp: now.tempHp, beastHp: now.wildShape?.beastHp ?? null });
  return {
    given: oldLanded - newLanded,
    hp: `${now.currentHp}/${maxHp}`,
    notes,
  };
}
