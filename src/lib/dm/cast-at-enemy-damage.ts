// cast_at_enemy's damage: the spell's dice with the caster's riders (a
// subclass die, Potent Cantrip), halved or stopped by the save, floored where
// the spell says so, then landed through the enemy damage path; a kill wakes
// the features that answer one. Split from cast-at-enemy.ts, which has
// checked and paid for the cast and rolled the save before calling this.

import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollCard } from "@/lib/dm/action-common";
import { rollAgainst } from "@/lib/roll-labels";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredOnKill } from "@/lib/dm/authored-hooks";
import { applyEnemyDamage } from "@/lib/dm/enemy-damage";
import { darkOnesBlessing } from "@/lib/dm/feature-hooks";
import { flooredDamage, maximizedDamage } from "@/lib/dm/spell-riders";
import { curseBurn } from "@/lib/dm/spell-retort";
import { spellDamageRiders } from "@/lib/srd/spell-damage-riders";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Rolls and lands the damage, writing what happened onto `base`; returns the
// damage dealt.
export function landSpellDamage(input: {
  campaign: Campaign;
  turn: DmTurn;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  spell: string;
  // The spell's own name, for its damage card.
  spellName: string;
  authors: string[];
  mech: NonNullable<ReturnType<typeof spellMechanicsFor>>["mech"] | null;
  facts: ReturnType<typeof spellFactsFor>;
  scaled: ReturnType<typeof spellDamageFor>;
  damageExpression: string;
  damageType: string | undefined;
  spellLevel: number;
  halfOnSave: boolean;
  saved: boolean;
  base: Record<string, unknown>;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): number {
  const { campaign, turn, encounter, sheet, enemy, spell, spellName, authors, mech, facts, scaled, damageExpression, damageType, spellLevel, halfOnSave, saved, base, sheets, sheetsById } = input;
  const riders = spellDamageRiders(sheet, {
    school: spellSchoolFor(spell, authors),
    damageType,
    level: spellLevel,
    classes: facts?.classes,
  });
  // Blight on a plant: the dice's maximum, rolled as no dice at all.
  // A subclass feature's die rides the roll (Enhanced Bond, Arcane Firearm).
  const rolledExpression = [damageExpression, ...riders.dice].join("+");
  const maxed = maximizedDamage(mech, enemy, rolledExpression);
  // The card shows the dice as rolled; the save halves or stops what lands.
  // A maximized blow rolls no dice, so it has no card.
  const outcome =
    maxed === null
      ? rollCard(campaign, turn, sheet.id, "damage", rollAgainst(spellName, enemy.displayName), rolledExpression, { kind: "sheet", id: sheet.id, name: sheet.name })
      : { total: maxed };
  const total = outcome.total + riders.flat;
  const halves = halfOnSave || riders.potentCantrip;
  // Feeblemind's damage lands whatever the save (spell-mech-types.ts).
  let damageDealt = saved && !mech?.riders?.damageIgnoresSave ? (halves ? Math.floor(total / 2) : 0) : total;
  // Harm: never below 1 hit point. The floor is on what gets through the
  // creature's resistances, so those are weighed here and not again.
  const floored = flooredDamage(mech, enemy, damageDealt, damageType);
  if (floored !== null) {
    damageDealt = floored;
  }
  if (riders.notes.length) {
    base.riders = riders.notes;
  }
  if (saved && riders.potentCantrip && !halfOnSave) {
    base.potentCantrip = "Potent Cantrip: the save still takes half.";
  }
  if (damageDealt > 0) {
    const applied = applyEnemyDamage(campaign, turn, encounter, enemy, damageDealt, sheets, sheetsById, floored === null ? damageType : undefined, {
      magical: true,
    });
    Object.assign(base, {
      damage: damageDealt,
      ...(damageType ? { damageType } : {}),
      ...(scaled ? { scaling: scaled.note } : {}),
      ...applied,
    });
    // Bestow Curse's necrotic on its caster's spell (spell-retort.ts).
    Object.assign(base, applied.dead ? {} : { curse: curseBurn(campaign, turn, enemy.id, sheet.id, sheets, sheetsById) ?? undefined });
    // Dark One's Blessing: a kill gives a Fiend warlock temporary hit points.
    const blessing = applied.dead ? darkOnesBlessing(campaign, sheet.id) : null;
    if (blessing) {
      base.darkOnesBlessing = blessing;
    }
    // Touch of Death, Keeper of Souls on the kill (authored-hooks.ts).
    const onKill = applied.dead && encounter ? authoredOnKill(campaign, encounter, enemy, sheet.id) : [];
    if (onKill.length) {
      base.subclassFeatures = onKill;
    }
  } else {
    base.damage = 0;
  }
  return damageDealt;
}
