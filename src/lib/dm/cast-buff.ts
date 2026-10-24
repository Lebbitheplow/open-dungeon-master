// cast_buff: a spell that grants an ongoing effect to the caster or allies
// (Bless, Haste, Aid, Spirit Guardians, Hunter's Mark). The server spends the
// slot through the one cast guard, applies the effect as a tracked condition
// with its real mechanics and duration, and records the spell, the caster
// and the slot on it (src/lib/dm/spell-effects.ts), so concentration ends
// only this casting and an aura rolls this slot's dice.
//
// Split out of cast-tools.ts, which re-exports it. Imports mutations (for
// the slot spend) and must never be imported by it.

import { rollCard } from "@/lib/dm/roll-card";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted } from "@/lib/events";
import { findSpellByName, spellEngineName, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { beastFormsHolding, findShapeForm, formatCr, wildShapeRecord } from "@/lib/srd/beast-forms";
import { attackSummary } from "@/lib/srd/creature-attacks";
import { speedWords } from "@/lib/srd/srd-creatures";
import { findFormFor, formDefenses, formsOf, shapedAbilities, shapedForm, shapeOffer, shapeProblem, shapeRuleFor } from "@/lib/srd/shape-rules";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { applyDmMutation, castBarred } from "@/lib/dm/mutations";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { unknownCombatantRef } from "@/lib/dm/combatant";
import { isSheetFoe } from "@/lib/dm/combat-sides-logic";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { lifetimeAtSlot } from "@/lib/dm/spell-effects";
import { withTempHpClaim, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { healDeathHook } from "@/lib/dm/death";
import { castToNoEffect, spellReachProblem, spellWardOn } from "@/lib/dm/cast-reach";
import { castShares } from "@/lib/srd/spell-mechanics";
import { castRedirect } from "@/lib/dm/cast-redirect";
import { castCure } from "@/lib/dm/cure-spell";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { handleDispelMagic } from "@/lib/dm/dispel";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import { castSummon } from "@/lib/dm/summon-cast";
import { castFindFamiliar, isFindFamiliar } from "@/lib/dm/familiar-cast";
import { castShapeAtEnemy, enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph";
import { allyRowRefusal, allyRowsOf, layBuffOnRows } from "@/lib/dm/cast-buff-allies";
import { unwillingResist } from "@/lib/dm/hostile-buffs";
import { holdingHint, noneNamed, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { nameChoice } from "@/lib/srd/feature-names";
import { castsSpells } from "@/lib/srd";

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
  // A mark's quarry, Dispel Magic's or a shape spell's target, or an ally creature.
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
): ToolResult {
  let args: z.infer<typeof castBuffSchema>;
  try {
    args = castBuffSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: cast_buff needs characterId and spell.", retry: true };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // A reaction spell is asked by the cast guard's reaction gate instead,
  // which judges one answering the hit that dropped the caster as they stood
  // before it (issue 233).
  if (sheet.currentHp <= 0 && spellFactsFor(args.spell, spellAuthorsFor(campaign))?.castingTime !== "reaction") {
    return { error: `${sheet.name} is at 0 HP and cannot cast.`, refused: "rules" };
  }
  if (!castsSpells(sheet)) {
    return { error: `${sheet.name} cannot cast spells.`, refused: "rules" };
  }
  const barred = castBarred(campaign, turn.id, { characterId: sheet.id, spell: args.spell, ...(args.level ? { level: args.level } : {}), via: "buff" }, sheets, sheetsById);
  if (barred) {
    return barred;
  }
  const authors = spellAuthorsFor(campaign);
  // The published spell a table's workshop copy runs as, for every rule
  // keyed by a spell's name: a renamed Conjure Animals still calls its
  // beasts, a renamed Polymorph still turns its target. The copy is cast
  // and held under its own name.
  const engine = spellEngineName(args.spell, authors);
  const castAs = findSpellByName(args.spell, authors)?.name ?? args.spell;
  // A spell that makes creatures brings them in with their stat blocks
  // (src/lib/dm/summon-cast.ts); `variant` names the creature.
  const summoning = summonSpellFor(engine);
  if (summoning) {
    return castSummon(
      campaign,
      { caster: sheet, spell: summoning, castAs, level: args.level, variant: args.variant, count: args.count, reason: args.reason },
      (cast) => applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  // Find Familiar binds a pet once the casting is paid (familiar-cast.ts).
  if (isFindFamiliar(engine)) {
    return castFindFamiliar(campaign, { caster: sheet, castAs, variant: args.variant, level: args.level, reason: args.reason, sheets, sheetsById }, (cast) =>
      applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userIds: authors });
  if (!resolvedMech) {
    return {
      error: `The server does not know "${args.spell}", so it cannot apply its effect. Spend the slot with use_spell_slot and narrate it; a human DM can set a story condition from the console.`,
      retry: true,
    };
  }
  if (resolvedMech.mech.dispel) {
    const encounter = getActiveEncounter(campaign.id);
    // Any combatant (src/lib/dm/combatant.ts): an enemy, or a character
    // fighting on the other side, whose spells are a sheet's.
    const enemy = args.targetEnemyId && encounter ? resolveTargetFoe(campaign.id, encounter, args.targetEnemyId) : null;
    const ally = args.targetCharacterIds?.[0] ? resolveSheetRef(args.targetCharacterIds[0], sheets, sheetsById) : null;
    if (!enemy && !ally) {
      return { error: `${resolvedMech.name} needs a target: targetEnemyId or one targetCharacterIds entry.`, retry: true };
    }
    return handleDispelMagic(campaign, turn, sheets, sheetsById, {
      caster: sheet,
      spell: resolvedMech.name,
      level: args.level,
      target: enemy ? { kind: isSheetFoe(enemy) ? "sheet" : "enemy", id: enemy.id } : { kind: "sheet", id: ally!.id },
      endSpell: args.endSpell,
      reason: args.reason,
    });
  }
  // Polymorph or True Polymorph at a creature of the fight: its WIS save and
  // the beast's block in place of its own (src/lib/dm/enemy-polymorph.ts).
  if (args.targetEnemyId && enemyShapeSpellFor(engine)) {
    const encounter = getActiveEncounter(campaign.id);
    const enemy = encounter ? resolveTargetFoe(campaign.id, encounter, args.targetEnemyId) : null;
    if (!enemy) {
      return encounter
        ? unknownCombatantRef(campaign.id, encounter, "targetEnemyId", args.targetEnemyId, "Nothing was spent.")
        : { error: "No fight is running: targetEnemyId names an enemy of a fight. Nothing was spent.", retry: true };
    }
    // A character's shape is its sheet's beast form: the path below, with the
    // save an unwilling creature makes (hostile-buffs.ts).
    if (isSheetFoe(enemy)) {
      args = { ...args, targetCharacterIds: [enemy.id], targetEnemyId: undefined };
    } else return castShapeAtEnemy(
      campaign,
      turn,
      { caster: sheet, enemy, spell: resolvedMech.name, runsAs: engine, variant: args.variant, level: args.level, reason: args.reason, authors },
      (cast) => applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const redirect = castRedirect(resolvedMech, "buff");
  if (redirect) {
    return redirect;
  }
  // Only a mark (Hunter's Mark, Hex) names an enemy here, or a creature on
  // the caster's side (cast-buff-allies.ts); any other buff given an enemy
  // would land on the caster instead, so it is refused unspent.
  const marking = MARKS.has(resolvedMech.mech.buff?.condition ?? "");
  const allies = allyRowsOf(campaign.id, sheet.id, marking ? [] : [...(args.targetCharacterIds ?? []), ...(args.targetEnemyId ? [args.targetEnemyId] : [])]);
  const sheetRefs = (marking ? (args.targetCharacterIds ?? []) : allies.rest).filter((ref) => ref !== args.targetEnemyId);
  if (args.targetEnemyId && !marking && allies.rest.includes(args.targetEnemyId)) {
    return {
      error: `${resolvedMech.name} cannot be cast on an enemy through cast_buff; name the caster or allies in targetCharacterIds, or cast a spell that targets enemies with cast_at_enemy. Nothing was spent.`,
      retry: true,
    };
  }
  // Restoration ends a condition rather than laying one (cure-spell.ts).
  const cures = resolvedMech.mech.cures;
  if (cures) {
    const named = args.targetCharacterIds?.[0] ? resolveSheetRef(args.targetCharacterIds[0], sheets, sheetsById) : null;
    return castCure(campaign, turn, { caster: sheet, target: named ?? sheet, resolved: resolvedMech, cures, variant: args.variant, level: args.level, reason: args.reason }, (cast) =>
      applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result,
    );
  }
  const buff = resolvedMech.mech.buff;
  if (!buff) {
    return {
      error: `${resolvedMech.name} carries no enforceable effect; spend the slot with use_spell_slot and narrate it.`,
      retry: true,
    };
  }
  const plannedSlot = resolvedMech.spellLevel >= 1 ? Math.max(resolvedMech.spellLevel, args.level ?? 0) : null;

  // The condition applied: the spell's own, or the variant named whole or by
  // what its brackets hold ("fire" for "protection from energy (fire)"),
  // which a spell with variants needs; the slot may then buy a stronger one
  // (Magic Weapon +2 from a 4th level slot).
  let condition = buff.condition;
  if (buff.variants?.length) {
    const wanted = textKey(args.variant ?? "");
    const picked = buff.variants.find((entry) => [entry, nameChoice(entry) ?? ""].some((spelling) => textKey(spelling) === wanted));
    if (!picked) {
      return wanted
        ? noneNamed(`${resolvedMech.name} has no variant called`, (args.variant ?? "").trim(), buff.variants)
        : { error: `${resolvedMech.name} needs its variant: ${buff.variants.join(", ")}. Ask the player which, unless they named one. Nothing was spent.`, retry: true };
    }
    condition = picked;
  }

  // Polymorph, Animal Shapes, True Polymorph and Shapechange: the variant
  // names the form and the server applies its whole stat block as a
  // transformation (the wildShape machinery: the form's HP pool, stat
  // override, natural attacks, defenses). Resolved before the slot spends.
  // A beast spell named another creature finds it all the same, so the
  // refusal below can say it is no beast.
  const shapeRule = shapeRuleFor(engine);
  const namedForm = condition === "polymorphed" ? (findFormFor(shapeRule, args.variant ?? "") ?? findShapeForm(args.variant ?? "")) : null;
  const polymorphForm = namedForm ? shapedForm(shapeRule, namedForm) : null;
  // A marking spell names its quarry among the enemies.
  const encounterNow = getActiveEncounter(campaign.id);
  const quarry =
    MARKS.has(buff.condition) && args.targetEnemyId && encounterNow
      ? resolveTargetFoe(campaign.id, encounterNow, args.targetEnemyId)
      : null;
  if (MARKS.has(buff.condition) && args.targetEnemyId && !quarry) {
    return encounterNow
      ? unknownCombatantRef(campaign.id, encounterNow, "targetEnemyId", args.targetEnemyId, "Nothing was spent.")
      : { error: "No fight is running: a mark's targetEnemyId names an enemy of a fight. Nothing was spent.", retry: true };
  }

  // What reaches a character through the sheet has no place on a row.
  const rowRefusal = allyRowRefusal(resolvedMech.name, allies.rows, { sheetOnly: Boolean(polymorphForm || buff.maxHp || buff.tempHp || resolvedMech.mech.maxHpDice) });
  if (rowRefusal) return rowRefusal;
  // Resolve the recipients: self-only spells ignore stray targets.
  const targetSheets: CharacterSheet[] = [];
  const targetRows = buff.target === "self" ? [] : allies.rows;
  if (buff.target === "self" || (!sheetRefs.length && !targetRows.length)) {
    targetSheets.push(sheet);
  } else {
    for (const ref of sheetRefs) {
      const found = resolveSheetRef(ref, sheets, sheetsById);
      const fresh = found ? (getSheetById(found.id) ?? found) : null;
      if (fresh && !fresh.deathSaves?.dead && !targetSheets.some((entry) => entry.id === fresh.id)) {
        targetSheets.push(fresh);
      }
    }
    if (!targetSheets.length && !targetRows.length) {
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
  if (targetSheets.length + targetRows.length > most) {
    return {
      error: `${resolvedMech.name} from a level ${plannedSlot ?? resolvedMech.spellLevel} slot affects at most ${most} creature${most === 1 ? "" : "s"}; ${targetSheets.length + targetRows.length} were named. Name ${most} or fewer, or cast it from a higher slot. Ask the player which. Nothing was spent.`,
      retry: true,
    };
  }
  // 5e: the new form's CR may not exceed the target's level (Polymorph,
  // True Polymorph), 4 and Large (Animal Shapes), or the caster's level
  // (Shapechange), and a beast spell gives a beast: src/lib/srd/shape-rules.ts.
  if (condition === "polymorphed" && !polymorphForm) {
    const asked = args.variant?.trim()
      ? `The ${shapeRule.anyCreature ? "form" : "beast-form"} table holds no "${args.variant.trim()}"`
      : `${resolvedMech.name} needs the ${shapeRule.anyCreature ? "form" : "beast"} in variant`;
    const hint = args.variant?.trim() ? holdingHint(args.variant, beastFormsHolding(args.variant, formsOf(shapeRule)).map((form) => form.name)) : "";
    return {
      error: `${asked}; ${targetSheets[0].name} can become: ${shapeOffer(shapeRule, targetSheets[0], sheet.level)}.${hint} Ask the player which, unless they named one. Nothing was spent.`,
      retry: true,
    };
  }
  if (polymorphForm) {
    for (const target of targetSheets) {
      const problem = shapeProblem(shapeRule, polymorphForm, target, sheet.level);
      if (problem) {
        return { ...problem, error: `${problem.error.replace(`CR ${polymorphForm.cr}`, `CR ${formatCr(polymorphForm.cr)}`)} Within it: ${shapeOffer(shapeRule, target, sheet.level)}. Nothing was spent.` };
      }
    }
  }
  // On a mapped fight each recipient must be within the spell's range with
  // a clear path: a touch spell reaches only the creature beside the caster.
  const facts = spellFactsFor(args.spell, authors);
  // A recipient inside a ward (src/lib/dm/cast-reach.ts spellWardOn) is
  // targeted all the same, and the spell does nothing to them.
  const warded = new Map<string, string>();
  if (encounterNow) {
    for (const target of [...targetSheets, ...targetRows.map((row) => ({ id: row.id, name: row.displayName }))]) {
      const near = { encounterId: encounterNow.id, casterId: sheet.id, targetId: target.id, targetName: target.name, facts };
      const reach = spellReachProblem({ ...near, casterName: sheet.name });
      if (reach) {
        return reach;
      }
      const ward = spellWardOn(near);
      if (ward) {
        warded.set(target.id, ward);
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
  // A target fighting against the caster saves as an unwilling creature.
  for (const [id, line] of unwillingResist(campaign, turn, sheet, { name: resolvedMech.name, engine }, targetSheets)) warded.set(id, line);
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

  // The spell's own duration, from the slot it was cast from (Hex from a
  // 3rd-level slot: eight hours; until dispelled has no count). Rounds tick
  // in a fight and on the clock outside one (src/lib/dm/condition-tick.ts),
  // so Mage Armor's eight hours are eight hours.
  const lasts = lifetimeAtSlot(resolvedMech.name, buff.rounds, slotLevel, authors);
  const rounds = lasts === null ? null : Math.max(1, lasts);
  const duration =
    rounds === null
      ? {}
      : rounds <= 100
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
    if (warded.has(target.id)) {
      continue;
    }
    const fresh = getSheetById(target.id) ?? target;
    // Heroes' Feast rolls each diner's 2d10; it rides in the name as Aid's does.
    const feast = resolvedMech.mech.maxHpDice ? rollCard(campaign, turn, target.id, "custom", `${args.spell}: ${target.name}'s hit point maximum`, resolvedMech.mech.maxHpDice, null).total : 0;
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
    // The maximum (and the current hit points with it) follows the
    // condition from here: src/lib/db/sheets.ts patchSheet, maxHpRiders.
    if (polymorphForm) {
      // The whole stat block lands: beast HP pool, every ability score
      // (a polymorphed mind is the beast's), speed, and natural attacks.
      // Damage past the pool reverts the form (mutations.ts apply_damage).
      const shaped = patchSheet(target.id, {
        wildShape: wildShapeRecord(polymorphForm, {
          kind: "polymorph",
          keepsTraining: shapeRule.keepsTraining,
          abilities: shapedAbilities(shapeRule, polymorphForm, fresh.abilities),
        }),
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
        (buff.tempHp.dice ? rollCard(campaign, turn, target.id, "custom", `${args.spell}: temporary hit points`, buff.tempHp.dice, null).total : 0)
      : tempDice
        ? rollCard(campaign, turn, target.id, "custom", `${condition}: temporary hit points`, tempDice, null).total
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
        // The pool is the spell's: it goes when the spell does (sheets.ts).
        const granted = getSheetById(target.id);
        const laid = granted?.conditions.find((name) => name.toLowerCase() === condition.toLowerCase());
        if (granted && laid && granted.tempHp === tempHp) {
          patchSheet(target.id, { conditionMeta: withTempHpClaim(granted.conditionMeta as ConditionMetaMap, laid, { spell: resolvedMech.name, source: sheet.id }, tempHp) });
        }
      }
    }
    // Aid or Heroes' Feast lifting a dying creature's hit points above 0: it
    // is no longer dying (death.ts healDeathHook, as healing settles it).
    healDeathHook(campaign, turn.id, fresh);
  }
  applied.push(...layBuffOnRows(campaign, targetRows.filter((row) => !warded.has(row.id)), condition, spellMeta, rounds));
  const noEffect = [...warded.values()].join(" ");
  if (!applied.length && noEffect) {
    return { ok: true, spell: resolvedMech.name, targets: [], ...(cast.slot ? { slot: cast.slot } : {}), ...castToNoEffect(noEffect) };
  }
  if (!applied.length) {
    return { error: `${resolvedMech.name} landed on no valid target.`, retry: true };
  }

  const summary = conditionEffectsFor(condition)?.summary;
  return {
    ok: true,
    spell: resolvedMech.name,
    applied: condition,
    targets: applied,
    ...(noEffect ? { noEffect } : {}),
    ...(quarry ? { quarry: quarry.displayName } : {}),
    ...(maxHpGain ? { hitPoints: `+${maxHpGain} to the maximum and current hit points of each` } : {}),
    ...(polymorphForm
      ? {
          form: `${polymorphForm.name} (${polymorphForm.type}, CR ${formatCr(polymorphForm.cr)}): ${polymorphForm.hp} HP, AC ${polymorphForm.ac}, speed ${speedWords(polymorphForm.speeds)}`,
          formAttacks: polymorphForm.attacks.length ? polymorphForm.attacks.map(attackSummary).join(", ") : "none: this form has no attack",
          ...(formDefenses(polymorphForm) ? { formDefenses: formDefenses(polymorphForm) } : {}),
          ...(polymorphForm.traits ? { formTraits: polymorphForm.traits } : {}),
          ...(shapeRule.seenOnly ? { seen: shapeRule.seenOnly } : {}),
        }
      : {}),
    duration:
      "hours" in duration
        ? `${duration.hours} hour${duration.hours === 1 ? "" : "s"}`
        : "minutes" in duration
          ? `${duration.minutes} minutes`
          : rounds === null
            ? "until dispelled"
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
