import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import {
  getActiveEncounter,
  listEnemies,
  orderEntryId,
  patchEnemyConditions,
} from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { findSpellByName, spellMechanicsFor } from "@/lib/content";
import { allySaveAura } from "@/lib/dm/aura";
import { computeSheetDerived } from "@/lib/srd";
import { conditionConcentrationFloor, conditionRollRiders } from "@/lib/srd/condition-effects";
import { mergeAdvantage, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { heldBySpell, spellKey } from "@/lib/dm/spell-effects";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { endSpellZones } from "@/lib/dm/zone-store";
import { endSpellSummons } from "@/lib/dm/summon-store";
import { authoredConcentrationGuard } from "@/lib/srd/authored-effects-more";

// Server-tracked concentration: casting a concentration spell sets it (and
// breaks the previous one), taking damage forces the CON save server-side,
// and dropping to 0 HP always ends it. This module must not import
// mutations.ts (which imports it). Enemy concentration is out of scope;
// enemies have no tracked spells.

// Whether a spell requires concentration: exact-name match against the
// Open5e content pack plus the caster's homebrew. Null when unknown.
export function spellRequiresConcentration(spellName: string, userId: string): boolean | null {
  const exact = findSpellByName(spellName, userId);
  return exact ? exact.concentration : null;
}

function writeConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  concentratingOn: string | null,
  reason: string,
) {
  const patch = { concentratingOn };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "concentration",
    delta: patch,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Sets concentration on a newly cast spell; returns the spell it displaced,
// if any. Caller has already verified the spell requires concentration.
export function setConcentration(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  spell: string,
): { displaced: string | null } {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return { displaced: null };
  }
  const displaced = sheet.concentratingOn && sheet.concentratingOn !== spell
    ? sheet.concentratingOn
    : null;
  writeConcentration(campaign, turnId, sheet, spell, `casting ${spell}`);
  return { displaced };
}

export function breakConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheetId: string,
  cause: string,
): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet?.concentratingOn) {
    return null;
  }
  const spell = sheet.concentratingOn;
  writeConcentration(campaign, turnId, sheet, null, cause);
  // The spell's lingering effect conditions end with the concentration:
  // Bless's dice, Haste's action, Hold Person's paralysis all stop here
  // instead of waiting for their duration to expire.
  clearSpellConditionsByName(campaign, spell, sheet.userId, sheet.id);
  return spell;
}

// Haste's lethargy is the incapacitated condition, held until after the
// target's next turn. Durations count down at the round wrap
// (condition-tick.ts), so a target whose turn is still to come this round
// loses that turn (one round), and one who has already acted loses the
// next round's (two). Outside a fight it is the one round of six seconds.
export const LETHARGY = "incapacitated";

// Exported so the round wrap can apply the same lethargy when Haste runs
// out by its duration (src/lib/dm/condition-tick.ts). At the wrap the turn
// the pointer rests on has only just started, so that combatant has not had
// it yet (`turnStarting`); mid-turn, the one acting has. A character and an
// enemy are counted the same way: the id is the order entry's own.
export function lethargyRounds(
  encounter: ReturnType<typeof getActiveEncounter>,
  combatantId: string,
  turnStarting = false,
): number {
  if (!encounter?.orderReady) {
    return 1;
  }
  const place = encounter.order.findIndex((entry) => orderEntryId(entry) === combatantId);
  if (place < 0) {
    return 1;
  }
  return place > encounter.turnIndex || (turnStarting && place === encounter.turnIndex) ? 1 : 2;
}

// Removes the effect conditions a broken concentration spell was holding in
// place, from every party sheet and every living enemy in the active
// encounter. A condition records the spell and caster that laid it down
// (src/lib/dm/spell-effects.ts), so only THAT casting's conditions end: a
// goblin a ghoul paralyzed stays paralyzed when the wizard's Hold Person
// ends. `casterId` is the one whose spell ended; without it any caster's
// casting of the spell ends (an enemy's concentration, a legacy call).
// Best effort: an unknown/homebrew spell simply clears nothing.
// Shared by PC concentration (above) and enemy concentration breaks
// (src/lib/dm/enemy-damage.ts), which have no caster userId.
export function clearSpellConditionsByName(
  campaign: Campaign,
  spell: string,
  userId?: string,
  casterId?: string,
) {
  // Its area on the board goes with it (src/lib/dm/zone-store.ts), and the
  // creatures it made vanish or, where the spell says so, turn hostile
  // (src/lib/dm/summon-store.ts). Only a known caster's: an enemy's broken
  // concentration names none and must not send the party's away.
  endSpellZones(campaign.id, spell, casterId);
  if (casterId) {
    endSpellSummons(campaign, spell, casterId);
  }
  const resolved = spellMechanicsFor({ spell, userId });
  if (!resolved) {
    return;
  }
  const conditionNames = new Set(
    [
      resolved.mech.buff?.condition,
      ...(resolved.mech.buff?.variants ?? []),
      ...(resolved.mech.buff?.bySlot ?? []).map(([, name]) => name),
      resolved.mech.condition?.name,
      ...(resolved.mech.condition?.also ?? []),
      ...(resolved.mech.condition?.variants ?? []),
      resolved.mech.hitPointPool?.condition,
    ]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase()),
  );
  const spellNames = new Set([spellKey(spell), spellKey(resolved.name)]);
  const encounter = getActiveEncounter(campaign.id);
  for (const target of listSheets(campaign.id)) {
    const meta = target.conditionMeta as ConditionMetaMap;
    const held = target.conditions.filter((condition) =>
      heldBySpell(condition, meta[condition], spellNames, conditionNames, casterId),
    );
    // A polymorphed target reverts to their own body with the condition.
    const revertsForm =
      held.some((condition) => condition.toLowerCase() === "polymorphed") && target.wildShape?.kind === "polymorph";
    if (!held.length) {
      continue;
    }
    const cleared = removeConditions(target.conditions, target.conditionMeta, held);
    // SRD 5.1, Haste: when the spell ends the target cannot move or take
    // actions until after its next turn.
    const lethargy = held.some((condition) => condition.toLowerCase() === "hasted")
      ? lethargyRounds(encounter, target.id)
      : 0;
    if (lethargy && !cleared.conditions.includes(LETHARGY)) {
      cleared.conditions = [...cleared.conditions, LETHARGY];
      cleared.meta = { ...cleared.meta, [LETHARGY]: { rounds: lethargy, source: "haste" } };
    }
    const updated = patchSheet(target.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
      ...(revertsForm ? { wildShape: null } : {}),
      ...spellEndPatch(target, held),
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  if (!encounter) {
    return;
  }
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive") {
      continue;
    }
    const meta = enemy.conditionMeta as ConditionMetaMap;
    const held = (enemy.conditions ?? []).filter((condition) =>
      heldBySpell(condition, meta[condition], spellNames, conditionNames, casterId),
    );
    if (held.length) {
      const cleared = removeConditions(enemy.conditions ?? [], enemy.conditionMeta, held);
      // Haste's lethargy falls on a hasted enemy exactly as on a character.
      const hasteEnded = held.some((condition) => condition.toLowerCase() === "hasted");
      if (hasteEnded && !cleared.conditions.includes(LETHARGY)) {
        cleared.conditions = [...cleared.conditions, LETHARGY];
        cleared.meta = {
          ...cleared.meta,
          [LETHARGY]: { rounds: lethargyRounds(encounter, enemy.id), source: "haste" },
        };
      }
      patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    }
  }
}

// What else a sheet gives back when a spell's condition ends: Aid's extra
// hit points ("aided (+10)" carries the amount), down to the maximum it
// raised.
export function spellEndPatch(
  sheet: Pick<CharacterSheet, "maxHp" | "currentHp">,
  ended: string[],
): { maxHp?: number; currentHp?: number } {
  let lost = 0;
  for (const name of ended) {
    // Aid and Heroes' Feast carry what they gave in the name.
    const aid = /^(?:aided|heroes' feast) \(\+(\d+)\)$/i.exec(name.trim());
    if (aid) {
      lost += Number(aid[1]);
    }
  }
  if (!lost) {
    return {};
  }
  const maxHp = Math.max(1, sheet.maxHp - lost);
  return { maxHp, currentHp: Math.min(sheet.currentHp, maxHp) };
}

// Called from apply_damage after HP lands. Rolls the CON save (DC 10 or
// half the damage, whichever is higher) with a visible dice card; dropping
// to 0 HP breaks concentration without a save.
export function concentrationDamageHook(
  campaign: Campaign,
  turnId: string,
  preSheet: CharacterSheet,
  damage: number,
): Record<string, unknown> {
  if (!preSheet.concentratingOn || damage < 1) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh?.concentratingOn) {
    return {};
  }
  const spell = fresh.concentratingOn;
  if (fresh.currentHp <= 0) {
    breakConcentration(campaign, turnId, fresh.id, "dropped to 0 HP");
    return { concentrationBroken: spell };
  }
  // Grasping Tentacles: damage cannot break the concentration on Evard's
  // Black Tentacles (src/lib/srd/authored-effects-more.ts).
  const guarded = authoredConcentrationGuard(fresh, spell);
  if (guarded) {
    return { concentration: { spell, held: true, guarded: `${guarded.feature}: damage cannot break it` } };
  }
  const dc = Math.max(10, Math.floor(damage / 2));
  // A nearby paladin's aura protects concentration checks too (map-scoped).
  const aura = allySaveAura(campaign.id, fresh);
  const saveMod = computeSheetDerived(fresh).saves.con + (aura?.bonus ?? 0);
  // It is a saving throw like any other: Bless adds its d4 and Bane takes
  // one away. War Caster gives advantage on exactly this save.
  const riders = conditionRollRiders(fresh.conditions, "save", "con");
  const warCaster = [...(fresh.feats ?? []), ...fresh.features.map((feature) => feature.name)].some(
    (entry) => entry.toLowerCase().includes("war caster"),
  );
  const advantage = mergeAdvantage([...(warCaster ? ["advantage" as const] : []), ...riders.advantageSources]);
  const outcome = rollExpression(`${d20Expression(saveMod, advantage)}${riders.diceSuffix}`);
  if (riders.spent.length) {
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, riders.spent);
    patchSheet(fresh.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  }
  // Starry Form (Dragon) and its kin floor a low concentration d20 at 10.
  const floor = conditionConcentrationFloor(fresh.conditions);
  if (floor && outcome.natural !== undefined && outcome.natural < floor) {
    const floored = outcome.total - outcome.natural + floor;
    outcome.total = Math.max(outcome.total, floored);
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: fresh.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `CON save to keep concentration (${spell})`,
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const held = outcome.total >= dc;
  if (!held) {
    breakConcentration(campaign, turnId, fresh.id, `failed the DC ${dc} CON save`);
  }
  return {
    concentration: {
      spell,
      dc,
      rolled: outcome.total,
      held,
      ...(warCaster ? { warCaster: "advantage on the save" } : {}),
      ...(riders.notes.length ? { riders: riders.notes } : {}),
    },
  };
}
