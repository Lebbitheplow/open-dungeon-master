// A character sheet seen through the paths that strike, curse and make a foe
// save (issue 503, Phase 6). pc_attack, the spells cast at a foe, the
// opportunity strike and the rider saves were written against an enemy row;
// a character fighting on the other side (a companion turned on the party,
// a party member a turncoat swings at) is handed to them as a foe view: the
// enemy row's shape, its id the sheet's, its slug SHEET_FOE_SLUG, its block
// the sheet read as one (sheet-foe-stats.ts).
//
// What makes the view the sheet and not a copy of it:
//   - its Armor Class is the sheet's with every effect (ac-effects.ts
//     enemyAcWithEffects asks acWithEffects for it);
//   - its saves are the character's own (forced-save.ts rollEnemySave hands
//     them to rollCharacterSave: proficiency, auras, Bless, Evasion's kin);
//   - damage lands through the sheet's damage path (enemy-damage.ts
//     applyEnemyDamage and pc-attack-damage.ts landBlow hand it to
//     applyPcDamage: resistances, temporary hit points, concentration, the
//     death engine);
//   - a condition written by its id lands on the sheet (db/encounters.ts
//     patchEnemyConditions).
// A view is read fresh each time it is asked for; nothing keeps one.

import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { getActiveEncounter, getEnemy, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { SHEET_FOE_SLUG } from "@/lib/dm/combat-sides-logic";
import { combatantsOf, resolveCombatant } from "@/lib/dm/combatant";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { sheetEnemyStats } from "@/lib/dm/sheet-foe-stats";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function sheetFoeView(encounterId: string, sheet: CharacterSheet): EncounterEnemy {
  const stats = sheetEnemyStats(sheet);
  const view: EncounterEnemy = {
    id: sheet.id,
    encounterId,
    campaignId: sheet.campaignId,
    slug: SHEET_FOE_SLUG,
    displayName: sheet.name,
    maxHp: effectiveMaxHp(sheet),
    currentHp: Math.max(0, sheet.currentHp),
    ac: sheet.ac,
    initiative: null,
    // A character at 0 is dying, not dead: still a target (a blow is a
    // failed death save), and out of the fight (combatant.ts).
    status: sheet.deathSaves?.dead ? "dead" : "alive",
    cr: stats.cr,
    xp: stats.xp,
    conditions: [...sheet.conditions],
    conditionMeta: { ...sheet.conditionMeta },
    concentration: sheet.concentratingOn ?? null,
    concentrationRounds: sheet.concentrationRounds ?? null,
    stats,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
  };
  // The Armor Class every attack meets, effects and all (ac-effects.ts).
  const ac = enemyAcWithEffects(sheet.campaignId, view);
  return { ...view, ac, stats: { ...stats, ac } };
}

// An enemy row by id, or the foe view of the sheet with that id while its
// campaign has a fight running. What the foe paths re-read mid-attack.
export function getFoe(id: string): EncounterEnemy | null {
  const enemy = getEnemy(id);
  if (enemy) {
    return enemy;
  }
  const sheet = getSheetById(id);
  const encounter = sheet ? getActiveEncounter(sheet.campaignId) : null;
  return sheet && encounter ? sheetFoeView(encounter.id, sheet) : null;
}

// The target a foe path names, by id or name, through resolveCombatant: the
// enemy row, or the foe view of a sheet.
export function resolveTargetFoe(campaignId: string, encounter: Encounter, ref: string | null | undefined): EncounterEnemy | null {
  const combatant = resolveCombatant(campaignId, encounter, ref);
  if (!combatant) {
    return null;
  }
  return combatant.kind === "enemy" ? combatant.enemy : sheetFoeView(encounter.id, combatant.sheet);
}

// What the characters who fell fighting on the foes' side were worth to the
// party that beat them, each at the rating its sheet reads as
// (sheet-foe-stats.ts). One still standing when the fight ends was not
// beaten and is worth nothing (enemy-damage.ts finishEncounter).
export function fallenFoeSheetsXp(campaignId: string, encounter: Encounter): number {
  let total = 0;
  for (const combatant of combatantsOf(campaignId, encounter)) {
    if (combatant.kind !== "sheet" || combatant.side !== "foe" || combatant.sheet.currentHp > 0) {
      continue;
    }
    try {
      total += sheetEnemyStats(combatant.sheet).xp;
    } catch {
      // A sheet the derivations cannot read is worth nothing.
    }
  }
  return total;
}
