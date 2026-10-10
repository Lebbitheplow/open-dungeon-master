// The spends of a limited-use feature whose payload the server resolves
// itself, beyond the effect kinds use_resource runs for every counter
// (src/lib/dm/resource-tools.ts): Channel Divinity's options, where the
// variant names which one, and Indomitable's reroll of the save just failed.
//
// Before this the counter was spent and the model was handed a sentence:
// Turn Undead told it to "apply the frightened condition", which skipped the
// saving throw the SRD gates it behind, and Indomitable told it to roll the
// save again by hand. Each spend here checks, charges the turn, spends the
// use and applies the result, in that order, so a refusal costs nothing.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path. Must not import mutations.ts (which imports it).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { chebyshev } from "@/lib/battlemap/types";
import { computeSheetDerived } from "@/lib/srd";
import { matchResource } from "@/lib/srd/class-resources";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import { effectiveMaxHp, incapacitatedBy, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { healDeathHook } from "@/lib/dm/death";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { prepareResourceCharge } from "@/lib/dm/resource-turn";
import { fieldedSheets } from "@/lib/dm/roster";
import { chooseFiendishResilience, stillnessOfMind } from "@/lib/dm/feature-hooks";

// Re-exported for the callers that reached it here first.
export { applyInitiativeRefills, darkOnesBlessing } from "@/lib/dm/feature-hooks";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

// Destroy Undead's challenge rating threshold by cleric level (SRD 5.1).
export function destroyUndeadCr(clericLevel: number): number | null {
  if (clericLevel >= 17) return 4;
  if (clericLevel >= 14) return 3;
  if (clericLevel >= 11) return 2;
  if (clericLevel >= 8) return 1;
  if (clericLevel >= 5) return 0.5;
  return null;
}

// The condition a turned undead carries: it spends its turns moving away,
// takes no reactions, and may only Dash or try to escape. Taking damage ends
// it. Kept as its own name so a frightened from elsewhere is not confused
// with it.
export const TURNED = "turned";

const TURN_RANGE_FEET = 30;

function audit(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "use_resource",
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Whether two combatants are within `feet` of each other on the live board.
// With no board there is nothing to measure and the fiction decides.
function within(campaignId: string, fromRef: string, toRef: string, feet: number): boolean {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!map) {
    return true;
  }
  const from = getTokenByRef(map.id, fromRef);
  const to = getTokenByRef(map.id, toRef);
  if (!from || !to) {
    return false;
  }
  return chebyshev(from.x, from.y, to.x, to.y) <= Math.floor(feet / 5);
}

// A use_resource call this module resolves, or null for the generic path.
export function featureVariantSpend(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  resourceName: string,
  variant: string | undefined,
  targetId: string | undefined,
  reason: string,
): Record<string, unknown> | null {
  if (/^fiendish resilience\b/i.test(resourceName.trim())) {
    return chooseFiendishResilience(campaign, turnId, sheet, variant, reason);
  }
  if (/^stillness of mind\b/i.test(resourceName.trim())) {
    return stillnessOfMind(campaign, turnId, sheet, reason);
  }
  const def = matchResource(resourceName);
  const wanted = (variant ?? "").trim().toLowerCase();
  if (def?.id === "channel_divinity") {
    if (/turn the unholy/.test(wanted)) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () =>
        turnUndead(campaign, turnId, sheet, { types: /undead|fiend/i, destroy: false, name: "Turn the Unholy" }),
      );
    }
    if (/turn|destroy undead/.test(wanted)) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () => turnUndead(campaign, turnId, sheet));
    }
    if (/sacred weapon/.test(wanted)) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () => sacredWeapon(sheet));
    }
    if (/preserve life/.test(wanted)) {
      return spend(campaign, turnId, sheet, def.id, "action", reason, () =>
        preserveLife(campaign, turnId, sheet, targetId, reason),
      );
    }
    return null;
  }
  if (def?.id === "eldritch_master") {
    return spend(campaign, turnId, sheet, def.id, "none", reason, () => eldritchMaster(sheet));
  }
  if (def?.id === "indomitable") {
    return spend(campaign, turnId, sheet, def.id, "none", reason, () => indomitable(campaign, sheet));
  }
  if (def?.id === "ki" && /diamond soul/.test(wanted)) {
    // Diamond Soul (monk 14): 1 ki rerolls a failed save, as Indomitable does.
    if (!holdsFeature(sheet, "diamond soul")) {
      return { error: `${sheet.name} does not have Diamond Soul.` };
    }
    return spend(campaign, turnId, sheet, def.id, "none", reason, () => indomitable(campaign, sheet));
  }
  if (def?.id === "ki" && /empty body/.test(wanted)) {
    // Empty Body (monk 18): 4 ki, an action, invisible for a minute and
    // resistant to all damage but force.
    if (!holdsFeature(sheet, "empty body")) {
      return { error: `${sheet.name} does not have Empty Body.` };
    }
    return spend(campaign, turnId, sheet, def.id, "action", reason, () => emptyBody(sheet), 4);
  }
  return null;
}

type Resolution = { error: string } | { result: Record<string, unknown>; patch?: FullPatchSheetInput };

// The shared order: the feature is held with a use left, the character can
// act, the turn is charged, the effect resolves, and only then the use is
// spent. A resolution that refuses costs nothing.
function spend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceId: string,
  cost: "action" | "none",
  reason: string,
  resolve: () => Resolution,
  amount = 1,
): Record<string, unknown> {
  const sheet = getSheetById(stale.id) ?? stale;
  const def = matchResource(resourceId)!;
  const state = sheet.resources?.[resourceId];
  if (!state) {
    return { error: `${sheet.name} has no ${def.displayName}.` };
  }
  if (state.max - state.used < amount) {
    return {
      error: `${sheet.name} has ${state.max - state.used}/${state.max} ${def.displayName} left and this takes ${amount}; it comes back on a ${def.recharge === "short" ? "short or long" : "long"} rest.`,
    };
  }
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is down and cannot use ${def.displayName}.` };
  }
  // An action needs someone able to take one; a reroll (Indomitable) does not.
  const stoppedBy = cost === "action" ? incapacitatedBy(sheet.conditions) : null;
  if (stoppedBy) {
    return { error: `${sheet.name} is ${stoppedBy} and cannot use ${def.displayName} until the condition ends.` };
  }
  const charge = prepareResourceCharge(campaign, sheet, resourceId, cost);
  if ("error" in charge) {
    return charge;
  }
  const outcome = resolve();
  if ("error" in outcome) {
    return outcome;
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const resources = {
    ...now.resources,
    [resourceId]: { max: state.max, used: state.used + amount },
  };
  const patch = { ...(outcome.patch ?? {}), resources };
  patchSheet(sheet.id, patch);
  audit(campaign, turnId, now, { resource: def.displayName, spent: amount }, reason, patch);
  publishSheet(campaign, sheet.id);
  return {
    ok: true,
    resource: def.displayName,
    spent: amount,
    left: `${state.max - state.used - amount}/${state.max}`,
    ...outcome.result,
    ...charge.commit(),
  };
}

// Turn Undead (cleric 2) and Destroy Undead (cleric 5): every undead within
// 30 feet makes a WIS save against the cleric's spell DC. A failure turns it
// for a minute, or destroys it outright at or under the Destroy Undead CR.
// Turn the Unholy (Oath of Devotion 3) is the same save against fiends and
// undead, at the paladin's DC, with nothing destroyed.
function turnUndead(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  kind: { types: RegExp; destroy: boolean; name: string } = { types: /undead/i, destroy: true, name: "Turn Undead" },
): Resolution {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: `${kind.name} needs something to turn: start the encounter first.` };
  }
  const derived = computeSheetDerived(sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.wis, derived.abilityMods.cha);
  const destroyAt = kind.destroy ? destroyUndeadCr(classLevelOf(sheet, "cleric")) : null;
  const undead = listEnemies(encounter.id).filter(
    (enemy) =>
      enemy.status === "alive" &&
      kind.types.test(String(enemy.stats.type ?? "")) &&
      within(campaign.id, sheet.id, enemy.id, TURN_RANGE_FEET),
  );
  if (!undead.length) {
    return { error: `Nothing ${kind.name} affects is within ${TURN_RANGE_FEET} feet of ${sheet.name}; Channel Divinity was not spent.` };
  }
  const turn = getDmTurn(turnId);
  const sheets = listSheets(campaign.id);
  const byId = new Map(sheets.map((entry) => [entry.id, entry]));
  const outcomes: string[] = [];
  for (const enemy of undead) {
    // Turned: a legendary creature spends a resistance to stand its ground.
    const save = rollEnemySave(campaign.id, enemy, "wis", dc, { resist: true });
    if (save.success) {
      outcomes.push(`${enemy.displayName} resists (WIS ${save.total ?? "failed outright"} vs DC ${dc})${save.legendaryResistance ? " with Legendary Resistance" : ""}.`);
      continue;
    }
    const cr = Number(enemy.stats.cr ?? enemy.cr ?? 99);
    if (destroyAt !== null && cr <= destroyAt && turn) {
      applyEnemyDamage(campaign, turn, encounter, enemy, Math.max(1, enemy.currentHp), sheets, byId, undefined, {
        magical: true,
      });
      outcomes.push(`${enemy.displayName} is destroyed (CR ${cr} at or under ${destroyAt}).`);
      continue;
    }
    const conditions = enemy.conditions.includes(TURNED) ? enemy.conditions : [...enemy.conditions, TURNED];
    const meta: ConditionMetaMap = {
      ...(enemy.conditionMeta as ConditionMetaMap),
      [TURNED]: { rounds: 10, source: sheet.id },
    };
    patchEnemyConditions(enemy.id, conditions, meta);
    outcomes.push(`${enemy.displayName} is turned for a minute (WIS ${save.total ?? "failed"} vs DC ${dc}).`);
  }
  publishEncounter(campaign.id);
  return {
    result: {
      turnUndead: outcomes,
      note: "A turned undead spends its turns moving as far from the cleric as it can, takes no reactions, and may only Dash or try to escape; taking any damage ends it. Narrate these results; do not set frightened by hand.",
    },
  };
}

// Eldritch Master (warlock 20): every expended Pact Magic slot back. A
// multiclass sheet keeps its pact slots apart (spellcasting.pact); a
// warlock's own slots are the pact slots.
function eldritchMaster(sheet: CharacterSheet): Resolution {
  const casting = sheet.spellcasting;
  if (!casting) {
    return { error: `${sheet.name} has no Pact Magic slots to restore.` };
  }
  if (casting.pact) {
    return {
      patch: { spellcasting: { ...casting, pact: { ...casting.pact, used: 0 } } },
      result: { restored: "every Pact Magic slot" },
    };
  }
  const slots = Object.fromEntries(
    Object.entries(casting.slots).map(([level, slot]) => [level, { max: slot.max, used: 0 }]),
  );
  return { patch: { spellcasting: { ...casting, slots } }, result: { restored: "every Pact Magic slot" } };
}

// Empty Body (monk 18): invisible and resistant to all damage but force for
// a minute (the "empty body" row in condition-effects.ts).
function emptyBody(sheet: CharacterSheet): Resolution {
  const held = sheet.conditions.filter((entry) => !["invisible", "empty body"].includes(entry.toLowerCase()));
  return {
    patch: {
      conditions: [...held, "invisible", "empty body"],
      conditionMeta: { ...sheet.conditionMeta, invisible: { rounds: 10 }, "empty body": { rounds: 10 } },
    },
    result: { applied: "invisible and resistant to all damage except force, for a minute" },
  };
}

// Sacred Weapon (Oath of Devotion 3): the paladin's Charisma modifier (at
// least +1) on weapon attack rolls for a minute. The bonus rides the
// condition's name, which the attack engine reads (condition-effects.ts).
function sacredWeapon(sheet: CharacterSheet): Resolution {
  const bonus = Math.max(1, computeSheetDerived(sheet).abilityMods.cha);
  const condition = `sacred weapon (+${bonus})`;
  const held = sheet.conditions.filter((entry) => !/^sacred weapon/i.test(entry));
  return {
    patch: {
      conditions: [...held, condition],
      conditionMeta: { ...sheet.conditionMeta, [condition]: { rounds: 10 } },
    },
    result: { applied: `${condition} for 10 rounds: +${bonus} to weapon attack rolls, and the weapon sheds bright light.` },
  };
}

// Preserve Life (Life Domain 2): up to five times the cleric level in hit
// points, split among creatures within 30 feet, none above half its maximum.
// The named target first; the rest goes to the most hurt allies in reach.
function preserveLife(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  targetId: string | undefined,
  reason: string,
): Resolution {
  let pool = 5 * Math.max(1, classLevelOf(sheet, "cleric"));
  const party = fieldedSheets(campaign, listSheets(campaign.id))
    .map((entry) => getSheetById(entry.id) ?? entry)
    .filter((entry) => !entry.deathSaves?.dead && within(campaign.id, sheet.id, entry.id, 30));
  const room = (entry: CharacterSheet) =>
    Math.max(0, Math.floor(effectiveMaxHp(entry) / 2) - entry.currentHp);
  const ordered = [
    ...party.filter((entry) => entry.id === targetId),
    ...party.filter((entry) => entry.id !== targetId).sort((a, b) => a.currentHp - b.currentHp),
  ].filter((entry) => room(entry) > 0);
  if (!ordered.length) {
    return { error: "Preserve Life heals only creatures below half their hit points, and nobody in reach is. Channel Divinity was not spent." };
  }
  const healed: string[] = [];
  for (const target of ordered) {
    if (pool <= 0) {
      break;
    }
    const amount = Math.min(pool, room(target));
    pool -= amount;
    const currentHp = target.currentHp + amount;
    patchSheet(target.id, { currentHp });
    audit(campaign, turnId, target, { healed: amount, by: "Preserve Life" }, reason, { currentHp });
    healDeathHook(campaign, turnId, target);
    publishSheet(campaign, target.id);
    healed.push(`${target.name} +${amount} (${currentHp}/${effectiveMaxHp(target)})`);
  }
  return { result: { healed } };
}

// Indomitable (fighter 9): the save the fighter last failed is rolled again,
// and the new roll stands. On a success, the conditions that failure put on
// them (those that end on that same save) come off.
function indomitable(campaign: Campaign, sheet: CharacterSheet): Resolution {
  const failed = listRecentRolls(campaign.id, 60).find(
    (roll) =>
      roll.characterId === sheet.id &&
      roll.kind === "saving_throw" &&
      roll.dc !== null &&
      roll.total < roll.dc,
  );
  const ability = failed
    ? ((/\b(str|dex|con|int|wis|cha)\b/i.exec(failed.detail)?.[1] ?? "").toLowerCase() as Ability | "")
    : "";
  if (!failed || !ability) {
    return { error: `${sheet.name} has no failed saving throw to reroll; Indomitable was not spent.` };
  }
  const dc = failed.dc!;
  const against = /\bvs\.? (.+)$/i.exec(failed.detail)?.[1];
  const save = rollFeatureSave(campaign, sheet, ability, dc, "Indomitable reroll", against);
  if (!save.success) {
    return { result: { indomitable: `The reroll fails too (${ability.toUpperCase()} ${save.total ?? "failed"} vs DC ${dc}); the failure stands.` } };
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((name) => {
    const ends = meta[name]?.saveEnds;
    return ends && ends.ability === ability && ends.dc === dc;
  });
  const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
  return {
    patch: lifted.length ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {},
    result: {
      indomitable: `The reroll succeeds (${ability.toUpperCase()} ${save.total} vs DC ${dc})${
        lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""
      }.`,
    },
  };
}
