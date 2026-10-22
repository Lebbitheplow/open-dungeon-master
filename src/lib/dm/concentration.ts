import { concentrationFeat } from "@/lib/srd/feat-combat";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
} from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { spellEngineName, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { conditionConcentrationFloor } from "@/lib/srd/condition-effects";
import { addConditionInstance, instancesOf, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { fullDurationRule } from "@/lib/srd/full-duration";
import { heldBySpell, spellDurationRounds } from "@/lib/dm/spell-effects";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { endSpellZones } from "@/lib/dm/zone-store";
import { endSpellSummons } from "@/lib/dm/summon-store";
import { authoredConcentrationGuard } from "@/lib/srd/authored-effects-more";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { textKey } from "@/lib/language/text-logic";

// Server-tracked concentration: casting a concentration spell sets it (and
// breaks the previous one), taking damage forces the CON save server-side,
// and dropping to 0 HP always ends it. This module must not import
// mutations.ts (which imports it). Enemy concentration is out of scope;
// enemies have no tracked spells.

function writeConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  concentratingOn: string | null,
  reason: string,
  slotLevel?: number | null,
) {
  // A new spell starts its clock: the spell's own duration from the slot it
  // was cast from, counted down by src/lib/dm/concentration-clock.ts.
  const patch = {
    concentratingOn,
    ...(concentratingOn ? { concentrationRounds: concentrationRoundsFor(concentratingOn, sheet.userId, slotLevel) } : {}),
  };
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

// The rounds a concentration spell lasts at most from the slot it was cast
// from, or null when the facts do not say (an authored spell with no
// duration, a name nobody published).
export function concentrationRoundsFor(spell: string, authors?: string | string[], slotLevel?: number | null): number | null {
  return spellDurationRounds(spell, authors, slotLevel);
}

// Sets concentration on a newly cast spell (or a feature held the same way,
// Draconic Presence) and ends what it displaces, with every effect that
// casting held in place: the spell held before, or an earlier casting of the
// same spell (a second Hold Person ends the first one's hold; more targets
// of ONE casting never come here, cast-guard.ts open casts). Returns the
// spell it ended, if any. Caller has already verified the spell requires
// concentration, and lays the new casting's effects after this.
export function setConcentration(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  spell: string,
  // The slot it was cast from: a higher one can hold it longer (Hex).
  slotLevel?: number | null,
): { displaced: string | null } {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return { displaced: null };
  }
  const displaced = sheet.concentratingOn ?? null;
  writeConcentration(campaign, turnId, sheet, spell, `casting ${spell}`, slotLevel);
  if (displaced) {
    clearSpellConditionsByName(campaign, displaced, sheet.userId, sheet.id);
  }
  return { displaced };
}

// The line a cast's result carries for the concentration it ended.
export function droppedLine(displaced: string, spell: string): string {
  return textKey(displaced) === textKey(spell)
    ? `The earlier casting of ${spell} ended when it was cast again; its effects are gone.`
    : `${displaced} ended when ${spell} was cast; its effects are gone.`;
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
// target's next turn (SRD 5.1): it waits on that turn and ends with it
// (src/lib/dm/turn-end.ts untilTurnEndOf), so a target walked past while
// lethargic loses exactly the one turn.
export const LETHARGY = "incapacitated";
// ...and no movement either: "lethargic" holds the speed at 0 for as long.
export const LETHARGIC = "lethargic";

export function lethargyMeta(combatantId: string): ConditionMeta {
  return { untilTurnEndOf: combatantId, source: "haste" };
}

// Lays Haste's lethargy, both halves with one lifetime, beside whatever else
// already holds the creature (another source's incapacitation keeps its own).
export function withLethargy(conditions: string[], meta: ConditionMetaMap, lifetime: ConditionMeta): { conditions: string[]; meta: ConditionMetaMap } {
  let next = { conditions, meta };
  for (const name of [LETHARGY, LETHARGIC]) {
    next = addConditionInstance(next.conditions, next.meta, name, lifetime);
  }
  return next;
}

// Removes the effect conditions a broken concentration spell was holding in
// place, from every party sheet and every living enemy in the active
// encounter. A condition records the spell and caster that laid it down
// (src/lib/dm/spell-effects.ts), so only THAT casting's conditions end: a
// goblin a ghoul paralyzed stays paralyzed when the wizard's Hold Person
// ends. `casterId` is the one whose spell ended; without it any caster's
// casting of the spell ends (an enemy's concentration, a legacy call).
// A name with no mechanics row (a feature held like a spell, Draconic
// Presence) ends the conditions that carry its name.
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
  // The table's spells, whoever's sheet the caster is (spell-authors.ts).
  const resolved = spellMechanicsFor({ spell, userIds: [...spellAuthorsFor(campaign), ...(userId ? [userId] : [])] });
  const mech = resolved?.mech;
  const conditionNames = new Set(
    [
      mech?.buff?.condition,
      ...(mech?.buff?.variants ?? []),
      ...(mech?.buff?.bySlot ?? []).map(([, name]) => name),
      mech?.condition?.name,
      ...(mech?.condition?.also ?? []),
      ...(mech?.condition?.variants ?? []),
      mech?.hitPointPool?.condition,
    ]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase()),
  );
  const spellNames = new Set([textKey(spell), ...(resolved ? [textKey(resolved.name)] : [])]);
  const encounter = getActiveEncounter(campaign.id);
  for (const target of listSheets(campaign.id)) {
    // Only this casting's instances go: a condition another source still
    // holds stays (src/lib/dm/condition-logic.ts removeConditionInstances).
    const cleared = withoutSpellInstances(target.conditions, target.conditionMeta as ConditionMetaMap, spellNames, conditionNames, casterId);
    const held = cleared.ended;
    if (!cleared.changed) {
      continue;
    }
    // A polymorphed target reverts to their own body with the condition.
    const revertsForm =
      held.some((condition) => condition.toLowerCase() === "polymorphed") && target.wildShape?.kind === "polymorph";
    // SRD 5.1, Haste: when the spell ends the target cannot move or take
    // actions until after its next turn.
    const lethargy = held.some((condition) => condition.toLowerCase() === "hasted");
    if (lethargy) {
      Object.assign(cleared, withLethargy(cleared.conditions, cleared.meta, lethargyMeta(target.id)));
    }
    const updated = patchSheet(target.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
      ...(revertsForm ? { wildShape: null } : {}),
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
    const cleared = withoutSpellInstances(enemy.conditions ?? [], enemy.conditionMeta as ConditionMetaMap, spellNames, conditionNames, casterId);
    const held = cleared.ended;
    if (cleared.changed) {
      // Haste's lethargy falls on a hasted enemy exactly as on a character.
      const hasteEnded = held.some((condition) => condition.toLowerCase() === "hasted");
      if (hasteEnded) {
        Object.assign(cleared, withLethargy(cleared.conditions, cleared.meta, lethargyMeta(enemy.id)));
      }
      patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    }
  }
}

// A spell held for its whole duration whose result then outlasts it
// (src/lib/srd/full-duration.ts): the instances the casting holds are taken
// from the spell, so its end no longer reaches them (Flesh to Stone's creature
// turned to stone first). Called as the clock runs out, before the
// concentration ends (concentration-clock.ts). Returns lines for the table.
export function settleFullDuration(campaign: Campaign, spell: string, casterId: string): string[] {
  const resolved = spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) });
  const rule = fullDurationRule(resolved?.runsAs ?? resolved?.name ?? spell) ?? fullDurationRule(spell);
  if (!rule) {
    return [];
  }
  const names = new Set([textKey(spell), ...(resolved ? [textKey(resolved.name)] : [])]);
  const ours = (entry: ConditionMeta) => Boolean(entry.spell && names.has(textKey(entry.spell))) && entry.source === casterId;
  const settle = (conditions: string[], meta: ConditionMetaMap) => {
    let next = { conditions, meta };
    let touched = false;
    for (const name of conditions) {
      if (!instancesOf(meta[name]).some(ours)) {
        continue;
      }
      touched = true;
      const result = removeConditionInstances(next.conditions, next.meta, name, ours);
      next = { conditions: result.conditions, meta: result.meta };
      if (!rule.becomes) {
        next = addConditionInstance(next.conditions, next.meta, name, { source: casterId });
      }
    }
    return touched ? (rule.becomes ? addConditionInstance(next.conditions, next.meta, rule.becomes, { source: casterId }) : next) : null;
  };
  const lines: string[] = [];
  const outcome = rule.becomes ? `is ${rule.becomes} for good` : "stays as it is, no longer held by the spell";
  for (const target of listSheets(campaign.id)) {
    const settled = settle(target.conditions, target.conditionMeta as ConditionMetaMap);
    const updated = settled ? patchSheet(target.id, { conditions: settled.conditions, conditionMeta: settled.meta }) : null;
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      lines.push(`${target.name} ${outcome}: ${spell} was held for its whole duration.`);
    }
  }
  const encounter = getActiveEncounter(campaign.id);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const settled = enemy.status === "alive" ? settle(enemy.conditions, enemy.conditionMeta as ConditionMetaMap) : null;
    if (settled) {
      patchEnemyConditions(enemy.id, settled.conditions, settled.meta);
      lines.push(`${enemy.displayName} ${outcome}: ${spell} was held for its whole duration.`);
    }
  }
  return lines;
}

// One casting's instances taken off a creature's conditions: the names
// whose last instance went (`ended`), and whether anything changed.
export function withoutSpellInstances(
  conditions: string[],
  meta: ConditionMetaMap,
  spellNames: Set<string>,
  conditionNames: Set<string>,
  casterId?: string,
): { conditions: string[]; meta: ConditionMetaMap; ended: string[]; changed: boolean } {
  let nextConditions = conditions;
  let nextMeta = meta;
  const ended: string[] = [];
  let changed = false;
  for (const name of conditions) {
    const result = removeConditionInstances(nextConditions, nextMeta, name, (instance) =>
      heldBySpell(name, instance, spellNames, conditionNames, casterId),
    );
    if (result.removed) {
      changed = true;
      nextConditions = result.conditions;
      nextMeta = result.meta;
      if (result.ended) {
        ended.push(name);
      }
    }
  }
  return { conditions: nextConditions, meta: nextMeta, ended, changed };
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
  const guarded = authoredConcentrationGuard(fresh, spellEngineName(spell, spellAuthorsFor(campaign)));
  if (guarded) {
    return { concentration: { spell, held: true, guarded: `${guarded.feature}: damage cannot break it` } };
  }
  const dc = Math.max(10, Math.floor(damage / 2));
  // It is a saving throw like any other, rolled by the one builder every
  // save uses (src/lib/dm/forced-save.ts): a paladin's aura, Bless and Bane,
  // exhaustion, lasting effects, a held die and a halfling's Lucky all ride
  // it. War Caster's advantage, or Battle Caster's 1d6 expertise die
  // (src/lib/srd/feat-combat.ts), and Starry Form's floor under the d20 are
  // what this save adds.
  const feat = concentrationFeat(fresh);
  const warCaster = feat?.advantage === true;
  const floor = conditionConcentrationFloor(fresh.conditions);
  const save = rollCharacterSave(
    campaign,
    null,
    fresh,
    "con",
    dc,
    `CON save to keep concentration (${spell})`,
    undefined,
    null,
    warCaster ? { advantage: "advantage", reason: "War Caster: advantage to keep concentration" } : null,
    false,
    { ...(feat?.die ? { die: feat.die } : {}), ...(floor ? { floor } : {}) },
  );
  const held = save.success;
  if (!held) {
    breakConcentration(campaign, turnId, fresh.id, `failed the DC ${dc} CON save`);
  }
  return {
    concentration: {
      spell,
      dc,
      rolled: save.total,
      held,
      ...(feat ? { [feat.advantage ? "warCaster" : "battleCaster"]: feat.advantage ? "advantage on the save" : `+${feat.die} on the save` } : {}),
      ...(save.notes.length ? { riders: save.notes } : {}),
    },
  };
}
