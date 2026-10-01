// cast_buff: a spell that grants an ongoing effect to the caster or allies
// (Bless, Haste, Aid, Spirit Guardians, Hunter's Mark). The server spends the
// slot through the one cast guard, applies the effect as a tracked condition
// with its real mechanics and duration, and records the spell, the caster
// and the slot on it (src/lib/dm/spell-effects.ts), so concentration ends
// only this casting and an aura rolls this slot's dice.
//
// Split out of cast-tools.ts, which re-exports it. Imports mutations (for
// the slot spend) and must never be imported by it.

import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { findBeastForm, formatCr } from "@/lib/srd/beast-forms";
import { shapedAbilities, shapeProblem, shapeRuleFor } from "@/lib/srd/shape-rules";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { castShares } from "@/lib/srd/spell-mechanics";
import { castRedirect } from "@/lib/dm/cast-redirect";
import { castCure } from "@/lib/dm/cure-spell";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { handleDispelMagic } from "@/lib/dm/dispel";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import { castSummon } from "@/lib/dm/summon-cast";
import { castFindFamiliar, isFindFamiliar } from "@/lib/dm/familiar-cast";
import { castShapeAtEnemy, enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph";

// Temporary hit points a chosen variant grants on top of its condition.
const VARIANT_TEMP_HP: Record<string, string> = {
  "enhance ability (bear's endurance)": "2d6",
};

// Spells that mark one creature: the extra die rides only against it.
const MARKS = new Set(["hunter's mark", "hexing"]);

const castBuffSchema = z.object({
  characterId: z.string(),
  spell: z.string().max(80),
  level: z.coerce.number().int().min(1).max(9).optional(),
  targetCharacterIds: z.array(z.string()).max(6).optional(),
  // Hunter's Mark and Hex: the creature marked. Dispel Magic, Polymorph and
  // True Polymorph: the enemy. Any other buff refuses one.
  targetEnemyId: z.string().max(80).optional(),
  variant: z.string().max(40).optional(),
  // Dispel Magic: the spell to end on the target, when it holds several.
  endSpell: z.string().max(80).optional(),
  // A summoning spell: fewer creatures than the slot allows.
  count: z.coerce.number().int().min(1).max(40).optional(),
  reason: z.string().optional(),
});

export function handleCastBuff(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof castBuffSchema>;
  try {
    args = castBuffSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: cast_buff needs characterId and spell." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and cannot cast.` };
  }
  if (!sheet.spellcasting) {
    return { error: `${sheet.name} cannot cast spells.` };
  }
  // A spell that makes creatures brings them in with their stat blocks
  // (src/lib/dm/summon-cast.ts); `variant` names the creature.
  const summoning = summonSpellFor(args.spell);
  if (summoning) {
    return castSummon(
      campaign,
      { caster: sheet, spell: summoning, level: args.level, variant: args.variant, count: args.count, reason: args.reason },
      (cast) => applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  // Find Familiar binds a pet once the casting is paid (familiar-cast.ts).
  if (isFindFamiliar(args.spell)) {
    return castFindFamiliar(campaign, turn, { caster: sheet, variant: args.variant, level: args.level, reason: args.reason, sheets, sheetsById }, (cast) =>
      applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const authors = spellAuthorsFor(campaign);
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userIds: authors });
  if (!resolvedMech) {
    return {
      error: `The server does not know "${args.spell}", so it cannot apply its effect. Spend the slot with use_spell_slot and narrate it; a human DM can set a story condition from the console.`,
    };
  }
  if (resolvedMech.mech.dispel) {
    const encounter = getActiveEncounter(campaign.id);
    const enemy = args.targetEnemyId && encounter ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
    const ally = args.targetCharacterIds?.[0] ? resolveSheetRef(args.targetCharacterIds[0], sheets, sheetsById) : null;
    if (!enemy && !ally) {
      return { error: `${resolvedMech.name} needs a target: targetEnemyId or one targetCharacterIds entry.` };
    }
    return handleDispelMagic(campaign, turn, sheets, sheetsById, {
      caster: sheet,
      spell: resolvedMech.name,
      level: args.level,
      target: enemy ? { kind: "enemy", id: enemy.id } : { kind: "sheet", id: ally!.id },
      endSpell: args.endSpell,
      reason: args.reason,
    });
  }
  // Polymorph or True Polymorph at a creature of the fight: its WIS save and
  // the beast's block in place of its own (src/lib/dm/enemy-polymorph.ts).
  if (args.targetEnemyId && enemyShapeSpellFor(resolvedMech.name)) {
    const encounter = getActiveEncounter(campaign.id);
    const enemy = encounter ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
    if (!enemy) {
      return { error: "Unknown targetEnemyId; use one from GAME STATE. Nothing was spent." };
    }
    return castShapeAtEnemy(
      campaign,
      turn,
      { caster: sheet, enemy, spell: resolvedMech.name, variant: args.variant, level: args.level, reason: args.reason, authors },
      (cast) => applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const redirect = castRedirect(resolvedMech, "buff");
  if (redirect) {
    return { error: redirect };
  }
  // Only a mark (Hunter's Mark, Hex) names an enemy here. Any other buff
  // given one would land on the caster instead, so it is refused unspent.
  if (args.targetEnemyId && !MARKS.has(resolvedMech.mech.buff?.condition ?? "")) {
    return {
      error: `${resolvedMech.name} cannot be cast on an enemy through cast_buff; name the caster or allies in targetCharacterIds, or cast a spell that targets enemies with cast_at_enemy. Nothing was spent.`,
    };
  }
  // Restoration ends a condition rather than laying one (cure-spell.ts).
  if (resolvedMech.mech.cures) {
    const named = args.targetCharacterIds?.[0] ? resolveSheetRef(args.targetCharacterIds[0], sheets, sheetsById) : null;
    return castCure(campaign, turn, { caster: sheet, target: named ?? sheet, resolved: resolvedMech, variant: args.variant, level: args.level, reason: args.reason }, (cast) =>
      applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const buff = resolvedMech.mech.buff;
  if (!buff) {
    return {
      error: `${resolvedMech.name} carries no enforceable effect; spend the slot with use_spell_slot and narrate it.`,
    };
  }
  const plannedSlot = resolvedMech.spellLevel >= 1 ? Math.max(resolvedMech.spellLevel, args.level ?? 0) : null;

  // The condition applied: the spell's own, a declared variant, or the one
  // the slot buys (Magic Weapon +2 from a 4th level slot).
  const wantedVariant = (args.variant ?? "").trim().toLowerCase();
  let condition =
    wantedVariant && buff.variants?.some((entry) => entry.toLowerCase().includes(wantedVariant))
      ? buff.variants.find((entry) => entry.toLowerCase().includes(wantedVariant))!
      : buff.condition;

  // Polymorph: the variant names the beast form and the server applies its
  // whole stat block as a transformation (the wildShape machinery: beast HP
  // pool, stat override, natural attacks). Resolved before the slot spends.
  const polymorphForm = condition === "polymorphed" ? findBeastForm(args.variant ?? "") : null;
  if (condition === "polymorphed" && !polymorphForm) {
    return {
      error: `${resolvedMech.name} needs a beast form the table knows: pass variant (e.g. 'giant ape', 'brown bear', 'tyrannosaurus rex').`,
    };
  }
  // A marking spell names its quarry among the enemies.
  const encounterNow = getActiveEncounter(campaign.id);
  const quarry =
    MARKS.has(buff.condition) && args.targetEnemyId && encounterNow
      ? resolveEnemyRef(encounterNow.id, args.targetEnemyId)
      : null;
  if (MARKS.has(buff.condition) && args.targetEnemyId && !quarry) {
    return { error: "Unknown targetEnemyId for the mark; use one from GAME STATE. Nothing was spent." };
  }

  // Resolve the recipients: self-only spells ignore stray targets.
  const targetSheets: CharacterSheet[] = [];
  if (buff.target === "self" || !args.targetCharacterIds?.length) {
    targetSheets.push(sheet);
  } else {
    for (const ref of args.targetCharacterIds) {
      const found = resolveSheetRef(ref, sheets, sheetsById);
      const fresh = found ? (getSheetById(found.id) ?? found) : null;
      if (fresh && !fresh.deathSaves?.dead && !targetSheets.some((entry) => entry.id === fresh.id)) {
        targetSheets.push(fresh);
      }
    }
    if (!targetSheets.length) {
      targetSheets.push(sheet);
    }
  }
  // How many creatures one casting touches: Bless three, one more for each
  // slot level above 1st; Aid three; a single-target buff one, or one more
  // a slot level where the spell says so (Fly, Enhance Ability).
  const shares = resolvedMech.mech.targets
    ? castShares(resolvedMech.mech, {
        spellLevel: resolvedMech.spellLevel,
        slotLevel: plannedSlot,
        casterLevel: sheet.level,
      })
    : null;
  const most = buff.target === "self" ? 1 : (shares ?? (buff.target === "ally" ? 1 : 6));
  if (targetSheets.length > most) {
    return {
      error: `${resolvedMech.name} from a level ${plannedSlot ?? resolvedMech.spellLevel} slot affects at most ${most} creature${most === 1 ? "" : "s"}; ${targetSheets.length} were named. Name ${most} or fewer, or cast it from a higher slot. Nothing was spent.`,
    };
  }
  // 5e: the new form's CR may not exceed the target's level (Polymorph), 4
  // and Large (Animal Shapes), or the caster's level (Shapechange):
  // src/lib/srd/shape-rules.ts.
  const shapeRule = shapeRuleFor(resolvedMech.name);
  if (polymorphForm) {
    for (const target of targetSheets) {
      const problem = shapeProblem(shapeRule, polymorphForm, target, sheet.level);
      if (problem) {
        return { error: `${problem.replace(`CR ${polymorphForm.cr}`, `CR ${formatCr(polymorphForm.cr)}`)} Nothing was spent.` };
      }
    }
  }
  // On a mapped fight each recipient must be within the spell's range with
  // a clear path: a touch spell reaches only the creature beside the caster.
  const facts = spellFactsFor(args.spell, authors);
  if (encounterNow) {
    for (const target of targetSheets) {
      const reach = spellReachProblem({
        encounterId: encounterNow.id,
        casterId: sheet.id,
        casterName: sheet.name,
        targetId: target.id,
        targetName: target.name,
        facts,
      });
      if (reach) {
        return { error: reach };
      }
    }
  }

  // The cast, through the one guard (src/lib/dm/cast-guard.ts): the list,
  // the slot of the spell's own level when none is named (a warlock's pact
  // level), the turn, the material and concentration (a second
  // concentration spell ends the first and its effects).
  const cast = applyDmMutation(
    campaign,
    turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: sheet.id,
      spell: args.spell,
      ...(args.level ? { level: args.level } : {}),
      via: "buff",
      reason: (args.reason ?? "").slice(0, 200),
    }),
    sheets,
    sheetsById,
  ).result;
  if ("error" in cast) {
    return cast;
  }
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : null;
  const above = Math.max(0, (slotLevel ?? resolvedMech.spellLevel) - resolvedMech.spellLevel);
  if (buff.bySlot?.length) {
    for (const [atLevel, variant] of buff.bySlot) {
      if ((slotLevel ?? resolvedMech.spellLevel) >= atLevel) {
        condition = variant;
      }
    }
  }
  // Aid raises the maximum and the current hit points; the amount rides in
  // the condition's name so the spell's end gives back exactly that.
  const maxHpGain = buff.maxHp ? buff.maxHp.base + (buff.maxHp.perSlotLevel ?? 0) * above : 0;
  if (maxHpGain) {
    condition = `${condition} (+${maxHpGain})`;
  }

  // The spell's own duration. Rounds tick in a fight and on the clock
  // outside one (src/lib/dm/condition-tick.ts), so Mage Armor's eight hours
  // are eight hours.
  const rounds = Math.max(1, buff.rounds);
  const duration =
    rounds <= 100
      ? { rounds }
      : rounds % 600 === 0 && rounds / 600 <= 24
        ? { hours: rounds / 600 }
        : { minutes: Math.min(1440, Math.ceil(rounds / 10)) };
  const spellMeta: ConditionMeta = {
    spell: resolvedMech.name,
    source: sheet.id,
    ...(slotLevel ? { slotLevel } : {}),
    ...(quarry ? { quarry: quarry.id } : {}),
  };
  const applied: string[] = [];
  for (const target of targetSheets) {
    const fresh = getSheetById(target.id) ?? target;
    // Heroes' Feast rolls each diner's 2d10; it rides in the name as Aid's does.
    const feast = resolvedMech.mech.maxHpDice ? rollExpression(resolvedMech.mech.maxHpDice).total : 0;
    const gain = maxHpGain || feast;
    const outcome = handleSetCondition(
      campaign,
      turn.id,
      fresh,
      { condition: feast ? `${condition} (+${feast})` : condition, ...duration },
      `${resolvedMech.name} cast by ${sheet.name}`,
      { spellEffect: spellMeta },
    );
    if ("error" in outcome) {
      continue;
    }
    applied.push(target.name);
    if (gain) {
      const now = getSheetById(target.id);
      if (now) {
        const raised = patchSheet(now.id, { maxHp: now.maxHp + gain, currentHp: now.currentHp + gain });
        if (raised) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: raised });
        }
      }
    }
    if (polymorphForm) {
      // The whole stat block lands: beast HP pool, every ability score
      // (a polymorphed mind is the beast's), speed, and natural attacks.
      // Damage past the pool reverts the form (mutations.ts apply_damage).
      const shaped = patchSheet(target.id, {
        wildShape: {
          form: polymorphForm.name,
          beastHp: polymorphForm.hp,
          beastMaxHp: polymorphForm.hp,
          beastAc: polymorphForm.ac,
          kind: "polymorph",
          abilities: shapedAbilities(shapeRule, polymorphForm, fresh.abilities),
          speed: polymorphForm.speed,
          attacks: polymorphForm.attacks,
        },
      });
      if (shaped) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: shaped });
      }
    }
    // Temporary hit points ride the cast (False Life, Bear's Endurance); 5e
    // temp HP never stacks, the higher value stands.
    const tempDice = VARIANT_TEMP_HP[condition.toLowerCase()];
    const tempHp = buff.tempHp
      ? buff.tempHp.base +
        (buff.tempHp.perSlotLevel ?? 0) * above +
        (buff.tempHp.dice ? rollExpression(buff.tempHp.dice).total : 0)
      : tempDice
        ? rollExpression(tempDice).total
        : 0;
    if (tempHp > 0) {
      const now = getSheetById(target.id);
      if (now && now.tempHp < tempHp) {
        applyDmMutation(
          campaign,
          turn.id,
          "heal",
          JSON.stringify({
            characterId: target.id,
            amount: tempHp,
            temp: true,
            reason: `${resolvedMech.name}: ${tempHp} temporary hit points`,
          }),
          sheets,
          sheetsById,
        );
      }
    }
  }
  if (!applied.length) {
    return { error: `${resolvedMech.name} landed on no valid target.` };
  }

  const summary = conditionEffectsFor(condition)?.summary;
  return {
    ok: true,
    spell: resolvedMech.name,
    applied: condition,
    targets: applied,
    ...(quarry ? { quarry: quarry.displayName } : {}),
    ...(maxHpGain ? { hitPoints: `+${maxHpGain} to the maximum and current hit points of each` } : {}),
    ...(polymorphForm
      ? {
          form: `${polymorphForm.name}: ${polymorphForm.hp} HP, AC ${polymorphForm.ac}, speed ${polymorphForm.speed} ft`,
          formAttacks: polymorphForm.attacks
            .map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`)
            .join(", "),
          ...(polymorphForm.traits ? { formTraits: polymorphForm.traits } : {}),
        }
      : {}),
    duration:
      "hours" in duration
        ? `${duration.hours} hour${duration.hours === 1 ? "" : "s"}`
        : "minutes" in duration
          ? `${duration.minutes} minutes`
          : `${rounds} round${rounds === 1 ? "" : "s"}`,
    ...(cast.cost ? { cost: cast.cost } : {}),
    ...(cast.slot ? { slot: cast.slot } : {}),
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
    ...(summary ? { effect: summary } : {}),
    ...(resolvedMech.mech.note ? { spellNote: resolvedMech.mech.note } : {}),
    ...(resolvedMech.concentration ? { concentration: `${sheet.name} is concentrating on ${resolvedMech.name}.` } : {}),
    note: "The server applied the effect; narrate exactly this.",
  };
}
