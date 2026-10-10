// aoe_damage on the characters an area catches: each rolls their own save
// from the real sheet (a published dice card), a failure lays the player
// spell's conditions, Evasion and Sculpt Spells apply, and the damage rides
// apply_damage so audit, undo and the death engine all run. Split from
// aoe-damage.ts, which rolls the blast once and calls this with it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import type { AoeSpellPlan } from "@/lib/dm/aoe-spell";
import { partsTaken, partsTotal, type DamagePart } from "@/lib/dm/aoe-parts";
import type { EnemyUse } from "@/lib/dm/enemy-casting";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { applyDmMutation } from "@/lib/dm/mutations";
import { handleSetCondition } from "@/lib/dm/set-condition";
import type { spellConditionMeta } from "@/lib/dm/spell-effects";
import { defenseRiders } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function aoeOnCharacters(input: {
  campaign: Campaign;
  turn: DmTurn;
  pcTargets: CharacterSheet[];
  plan: AoeSpellPlan | null;
  enemyUse: EnemyUse | null;
  // What a failed save lays, recorded with the spell and caster.
  conditionMeta: ReturnType<typeof spellConditionMeta> | null;
  ability: SaveAbility;
  dc: number;
  halfOnSave: boolean;
  // The blast as it lands, by damage type, and its whole.
  blast: DamagePart[];
  total: number;
  type?: string;
  spell?: string;
  reason?: string;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}): Array<Record<string, unknown>> {
  const { campaign, turn, pcTargets, plan, enemyUse, conditionMeta, ability, halfOnSave, blast, sheets, sheetsById } = input;
  const results: Array<Record<string, unknown>> = [];
  for (const sheet of pcTargets) {
    // Sculpt Spells: the evoker's chosen allies succeed and take nothing.
    if (plan?.sculpted.includes(sheet.id)) {
      results.push({ target: sheet.name, success: true, damage: 0, sculpted: `${plan.caster.name}'s Sculpt Spells shapes the spell around them.` });
      continue;
    }
    // The save a requested roll would be: conditions, a paladin's aura,
    // lasting effects, exhaustion and an inspiration die all count
    // (src/lib/dm/forced-save.ts).
    const save = rollCharacterSave(
      campaign,
      turn,
      sheet,
      ability,
      input.dc,
      `${ability.toUpperCase()} save vs area effect`,
      // What the save resists, so a trait keyed to it applies (a dwarf
      // against poison, a gnome against a spell).
      // An enemy's spell names its caster's type (Holy Nimbus).
      [input.type, input.spell ? "spell" : "", input.spell && enemyUse ? `spell cast by ${enemyUse.enemy.stats.type ?? ""}` : ""]
        .filter(Boolean)
        .join(" ") || undefined,
      enemyUse?.enemy ?? null,
    );
    // An automatic failure (a paralyzed creature's DEX save) is settled as
    // any failure: the spell's conditions land and Evasion still halves.
    const success = save.autoFailed ? false : save.success;
    // A player's spell that binds lays its conditions on a character who
    // fails, recorded with the spell (an ally caught in a Slow).
    if (!success && plan?.conditions.length && conditionMeta) {
      for (const condition of plan.conditions) {
        handleSetCondition(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { condition }, `${plan.spell} cast by ${plan.caster.name}`, {
          spellEffect: conditionMeta,
        });
      }
    }
    // Evasion: on a Dexterity save for half, a made save takes nothing and a
    // failed one takes half. Only for DEX saves against effects that would
    // deal half on a success at all.
    const evasion =
      ability === "dex" &&
      halfOnSave &&
      defenseRiders({ class: sheet.class, level: sheet.level, features: sheet.features }).evasion;
    const taken = partsTaken(blast, evasion ? (success ? "none" : "half") : success ? (halfOnSave ? "half" : "none") : "full");
    const damageTaken = partsTotal(taken);
    const row: Record<string, unknown> = {
      target: sheet.name,
      ...(save.autoFailed ? { autoFailed: save.notes.join("; ") } : { save: save.total }),
      success,
      damage: damageTaken,
      ...(evasion ? { evasion: success ? "no damage" : "half damage" } : {}),
    };
    for (const part of taken.filter((entry) => entry.amount > 0)) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: sheet.id,
          amount: part.amount,
          type: part.type,
          ...(input.spell ? { spell: input.spell } : {}),
          reason: (input.reason ?? "area effect").slice(0, 200),
        }),
        sheets,
        sheetsById,
      ).result;
      if (typeof applied.hp === "string") {
        row.hp = applied.hp;
      }
      if (applied.dying) {
        row.dying = applied.dying;
      }
      if (applied.dead) {
        row.dead = true;
      }
      if (applied.note) {
        row.note = applied.note;
      }
    }
    results.push(row);
  }
  return results;
}
