// A player's spell through aoe_damage: the caster pays for it and the
// spell's own numbers apply (SRD 5.1). Split out of the aoe_damage handler
// (encounter-tools-extra.ts), which keeps the saves and the damage.
//
// What this module decides, all before anything is spent:
//   - a spell named with no player caster is refused (aoe_damage is not a
//     free Fireball; an enemy's spell names casterEnemyId instead);
//   - how many creatures one casting may take (Slow: six);
//   - that every creature caught is within the spell's reach: its range
//     plus the size of its area, or the area itself for a Self spell;
//   - the cast through the one guard, a concentration spell's later turns
//     included (Call Lightning's next bolt spends no slot);
//   - the save, the DC, the dice, the type, the half, the conditions a
//     failed save lays down, and the caster's own damage riders.
//
// Imports mutations (for the slot spend) and must never be imported by it.

import type { Campaign } from "@/lib/db/campaigns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { castShares, type SpellMech } from "@/lib/srd/spell-mechanics";
import { spellDamageRiders } from "@/lib/srd/spell-damage-riders";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SaveAbilityId } from "@/lib/srd/condition-effects";
import { castRedirect } from "@/lib/dm/cast-redirect";
import { overchannelProblem, payOverchannel, sculptedIds } from "@/lib/dm/caster-features";
import { maximumOf } from "@/lib/dm/heal-spell";

const FEET_PER_TILE = 5;

export type AoeSpellPlan = {
  caster: CharacterSheet;
  spell: string;
  mech: SpellMech | null;
  // Null when the spell deals no damage (Entangle, Hypnotic Pattern).
  damage: string | null;
  // Added once to the rolled total (Empowered Evocation).
  flat: number;
  saveAbility: SaveAbilityId;
  dc: number;
  halfOnSave: boolean;
  type?: string;
  // The conditions a failed save lays down, the first being the spell's own.
  conditions: string[];
  spellLevel: number;
  slotLevel: number | null;
  noSave: boolean;
  corrections: string[];
  // Characters an evoker's Sculpt Spells spares (src/lib/dm/caster-features.ts).
  sculpted: string[];
};

export function planAoeSpell(
  campaign: Campaign,
  turn: DmTurn,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  input: {
    encounterId: string;
    spell: string;
    casterId?: string;
    level?: number;
    damage: string | number | undefined;
    // Overchannel: the spell's maximum damage.
    overchannel?: boolean;
    // Sculpt Spells: the characters to spare (every one caught when absent).
    sculpt?: string[];
    // Optional: the spell's own save and the caster's DC are used; the
    // caller's numbers count only where neither is known.
    saveAbility?: SaveAbilityId;
    dc?: number;
    halfOnSave?: boolean;
    type?: string;
    reason?: string;
    enemies: EncounterEnemy[];
    characters: CharacterSheet[];
  },
): AoeSpellPlan | { error: string } {
  if (!input.casterId) {
    return {
      error: `aoe_damage names ${input.spell} but no caster. A player's spell needs casterId (the server spends the slot and uses the spell's own numbers); an enemy's needs casterEnemyId; a trap or a breath weapon names no spell.`,
    };
  }
  const stale = resolveSheetRef(input.casterId, sheets, sheetsById);
  const caster = stale ? (getSheetById(stale.id) ?? stale) : null;
  if (!caster) {
    return { error: `casterId "${input.casterId}" is not a character in GAME STATE; nothing was cast.` };
  }
  const authors = spellAuthorsFor(campaign);
  const resolved = spellMechanicsFor({ spell: input.spell, userIds: authors });
  const facts = spellFactsFor(input.spell, authors);
  const mech = resolved?.mech ?? null;
  const name = resolved?.name ?? facts?.name ?? input.spell;
  const spellLevel = resolved?.spellLevel ?? facts?.level ?? 1;
  // A spell that summons, heals or grants a buff has no area to save in
  // (Animate Objects makes creatures; it is no blast of damage).
  if (mech && mech.resolution !== "save" && mech.resolution !== "auto") {
    return { error: `${castRedirect(resolved, "save") ?? `${name} is not resolved with aoe_damage.`} Nothing was spent.` };
  }
  // The save and the DC come from the spell and the caster's sheet; only a
  // spell the server has no row for needs the caller's, refused before any
  // slot is spent when they are missing.
  if (mech?.resolution !== "auto" && !mech?.save && !input.saveAbility) {
    return { error: `The server does not know which save ${name} forces; send saveAbility (and dc) with it. Nothing was spent.` };
  }
  if (mech?.resolution !== "auto" && !input.dc && !spellSaveDcFor(caster, input.spell)) {
    return { error: `${caster.name} has no spell save DC on their sheet for ${name}; send dc with it. Nothing was spent.` };
  }
  if (input.overchannel) {
    const problem = overchannelProblem(caster, facts, !mech?.noDamage);
    if (problem) {
      return { error: `${problem} Nothing was spent.` };
    }
  }

  // One casting of Slow takes six creatures; more is refused before the slot.
  const caught = input.enemies.length + input.characters.length;
  if (mech?.targets) {
    const most = castShares(mech, {
      spellLevel,
      slotLevel: input.level ?? null,
      casterLevel: caster.level,
    });
    if (caught > most) {
      return {
        error: `${name} from a level ${input.level ?? spellLevel} slot affects at most ${most} creatures; ${caught} were named. Name ${most} or fewer. Nothing was spent.`,
      };
    }
  }

  // Acid Splash: a second creature must stand within 5 feet of the first.
  const cluster = mech?.riders?.clusterFeet;
  if (cluster && input.enemies.length + input.characters.length > 1) {
    const ids = [...input.enemies.map((enemy) => enemy.id), ...input.characters.map((sheet) => sheet.id)];
    const apart = tilesBetween(input.encounterId, ids[0], ids[1]);
    if (apart !== null && apart > Math.floor(cluster / FEET_PER_TILE)) {
      return {
        error: `${name}'s two targets must stand within ${cluster} feet of each other; these are ${apart * FEET_PER_TILE} feet apart. Name one of them. Nothing was spent.`,
      };
    }
  }

  // Everyone caught must be where the spell can reach: a Self spell's own
  // area around the caster, anything else its range plus its area's size.
  const everyone = [
    ...input.enemies.map((enemy) => ({ id: enemy.id, name: enemy.displayName })),
    ...input.characters.map((sheet) => ({ id: sheet.id, name: sheet.name })),
  ].filter((entry) => entry.id !== caster.id);
  for (const target of everyone) {
    if (facts?.range.kind === "self") {
      const reach = spellReachProblem({
        encounterId: input.encounterId,
        casterId: caster.id,
        casterName: caster.name,
        targetId: target.id,
        targetName: target.name,
        facts,
      });
      if (reach) {
        return { error: reach };
      }
      continue;
    }
    if (facts?.range.kind !== "feet" || !mech?.areaFeet) {
      continue;
    }
    const apart = tilesBetween(input.encounterId, caster.id, target.id);
    const reachTiles = Math.floor((facts.range.feet + mech.areaFeet) / FEET_PER_TILE);
    if (apart !== null && apart > reachTiles) {
      return {
        error: `${target.name} is ${apart * FEET_PER_TILE} ft from ${caster.name}: ${name} reaches ${facts.range.feet} ft and its area ${mech.areaFeet} ft more, so it cannot catch them. Leave them out or move closer. No slot was spent.`,
      };
    }
  }

  // The cast through the one guard (src/lib/dm/cast-guard.ts).
  const cast = applyDmMutation(
    campaign,
    turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: caster.id,
      spell: input.spell,
      ...(input.level ? { level: input.level } : {}),
      via: "aoe",
      reason: (input.reason ?? "").slice(0, 200),
    }),
    sheets,
    sheetsById,
  ).result;
  if ("error" in cast) {
    return { error: String(cast.error) };
  }
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : null;
  const corrections: string[] = [];
  if (cast.repeat) {
    corrections.push(String(cast.repeat));
  }
  let damage: string | null = typeof input.damage === "number" ? String(input.damage) : (input.damage ?? null);
  // An "auto" spell rolls no save; the ability is a placeholder nobody rolls.
  let saveAbility: SaveAbilityId = input.saveAbility ?? mech?.save ?? "dex";
  let halfOnSave = input.halfOnSave ?? true;
  let type = input.type;
  if (mech && (mech.resolution === "save" || mech.resolution === "auto")) {
    const scaled = mech.noDamage
      ? null
      : spellDamageFor({ spell: input.spell, userIds: authors, casterLevel: caster.level, slotLevel: slotLevel ?? undefined });
    if (mech.noDamage) {
      damage = null;
    } else if (scaled) {
      damage = scaled.dice;
      corrections.push(scaled.note);
    }
    if (mech.save && mech.save !== saveAbility) {
      corrections.push(`${name} forces a ${mech.save.toUpperCase()} save; the server rolled the real one.`);
      saveAbility = mech.save;
    }
    halfOnSave = Boolean(mech.halfOnSave);
    if (mech.damageType) {
      type = mech.damageType;
    }
  }
  // Multiclass: the DC follows the class whose list carries the spell.
  let dc = input.dc ?? 0;
  const realDc = spellSaveDcFor(caster, input.spell);
  if (realDc && input.dc === undefined) {
    dc = realDc;
  } else if (realDc && realDc !== dc) {
    corrections.push(`Save DC ${realDc} from ${caster.name}'s sheet.`);
    dc = realDc;
  }
  if (cast.cost) {
    corrections.push(`${caster.name} spent ${cast.cost} casting ${name}.`);
  }
  const riders = damage
    ? spellDamageRiders(caster, {
        school: spellSchoolFor(input.spell, authors),
        damageType: type,
        level: spellLevel,
        classes: facts?.classes,
      })
    : { flat: 0, dice: [] as string[], potentCantrip: false, notes: [] as string[] };
  // A subclass feature's die rides the spell's one damage roll (Enhanced
  // Bond, Arcane Firearm): src/lib/srd/spell-damage-riders.ts.
  if (damage && riders.dice.length) {
    damage = [damage, ...riders.dice].join("+");
  }
  corrections.push(...riders.notes);
  if (riders.potentCantrip && !halfOnSave) {
    halfOnSave = true;
    corrections.push("Potent Cantrip: a successful save still takes half.");
  }
  // Overchannel: the dice at their maximum, and its price after the cast.
  if (input.overchannel && damage) {
    damage = String(maximumOf(damage));
    corrections.push(payOverchannel(campaign, turn, caster.id, spellLevel));
  }
  const condition = mech?.condition ?? null;
  return {
    caster,
    spell: name,
    mech,
    damage,
    flat: riders.flat,
    saveAbility,
    dc,
    halfOnSave,
    ...(type ? { type } : {}),
    conditions: condition ? [condition.name, ...(condition.also ?? [])].map(canonicalCondition) : [],
    spellLevel,
    slotLevel,
    noSave: mech?.resolution === "auto" || Boolean(condition?.noInitialSave),
    corrections,
    sculpted: sculptedIds(
      caster,
      spellSchoolFor(input.spell, authors),
      slotLevel ?? spellLevel,
      input.characters.map((sheet) => sheet.id),
      input.sculpt,
    ),
  };
}
