// aoe_damage: one save-or-damage effect on many creatures (a player's area
// spell planned by aoe-spell.ts, an enemy's breath or spell by enemy-casting.ts,
// a trap). Split out of encounter-tools-extra.ts; never imports encounter-tools.

import { magicImmunityProblem } from "@/lib/dm/monster-traits";
import { abilityAreaShape, areaProblem, spellAreaShape } from "@/lib/dm/aoe-shape";
import { spellFactsFor } from "@/lib/content";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { elementalAdeptApplies, floorDamageDice } from "@/lib/srd/feat-combat";
import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll, type RollAttacker } from "@/lib/db/rolls";
import { getBattleMapForEncounter, listHiddenRefIds } from "@/lib/db/battle-maps";
import { rollOn } from "@/lib/roll-labels";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { trackEnemyConcentration } from "@/lib/dm/cast-tools";
import { prepareEnemyUse, type EnemyUse } from "@/lib/dm/enemy-casting";
import { layEnemyCondition } from "@/lib/dm/cast-at-player";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { planAoeSpell, type AoeSpellPlan } from "@/lib/dm/aoe-spell";
import { aoePool } from "@/lib/dm/spell-pool";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { afterEnemySave, concentrationShaken, layAreaConditions, spellAutoSave, spellSaveOptions } from "@/lib/dm/spell-riders";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { getSheetById } from "@/lib/db/sheets";
import { rollEnemySave, settleFailedSave } from "@/lib/dm/forced-save";
import { aoeOnCharacters } from "@/lib/dm/aoe-characters";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { curseBurn } from "@/lib/dm/spell-retort";
import { holdEnemyAreaConcentration, placeSpellZone } from "@/lib/dm/zone-cast";
import { zoneArgsSchema, zonePlacement } from "@/lib/dm/zone-args";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { spellEngineName } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { globeProblemFor } from "@/lib/dm/zone-rules";
import { partsTaken, partsTotal, splitDamageExpression, type DamagePart } from "@/lib/dm/aoe-parts";
import { castingHold, outOfReach } from "@/lib/dm/spell-planes";
import { castPrismaticSpray, isPrismaticSpray } from "@/lib/dm/prismatic";

export { aoeDamageTool } from "@/lib/dm/aoe-damage-tool";
const aoeArgsSchema = z.object({
  // Optional for a player's spell that deals none (Entangle); a spell the
  // server knows rolls its own dice whatever is sent.
  damage: z.union([z.string().max(30), z.number().int().min(0).max(300)]).optional(),
  type: z.string().optional(),
  // Optional when a player's spell (casterId + spell) or an enemy's block
  // sets them; an effect that names neither must send both (refused below).
  saveAbility: z.preprocess(normalizeAbility, z.enum(["str", "dex", "con", "int", "wis", "cha"])).optional(),
  dc: z.coerce.number().int().min(1).max(30).optional(),
  halfOnSave: z.boolean().optional(),
  enemyIds: z.array(z.string()).optional(),
  characterIds: z.array(z.string()).optional(),
  targets: z.string().max(400).optional(),
  casterId: z.string().optional(),
  casterEnemyId: z.string().optional(),
  ability: z.string().max(80).optional(),
  spell: z.string().max(80).optional(),
  level: z.coerce.number().int().min(1).max(9).optional(),
  // A wizard's Overchannel and an evoker's Sculpt Spells (aoe-spell.ts).
  overchannel: z.coerce.boolean().optional(),
  sculpt: z.array(z.string()).max(10).optional(),
  reason: z.string().optional(),
  ...zoneArgsSchema,
});

export function handleAoeDamage(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof aoeArgsSchema>;
  try {
    args = aoeArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: aoe_damage needs targets, and saveAbility and dc unless a caster's spell or an enemy's ability sets them.",
    };
  }
  // A trap or a collapsing ceiling names no spell and no caster: its save
  // and DC are the caller's, and nothing else could supply them.
  if (!args.spell && !args.casterEnemyId && (!args.saveAbility || !args.dc)) {
    return {
      error: "aoe_damage needs saveAbility and dc for an effect that names no spell; a player's spell (casterId and spell) or an enemy's (casterEnemyId) brings its own.",
    };
  }

  // The area a player's spell lays is the one of the published spell a
  // table's workshop copy runs as (src/lib/content/index.ts spellEngineName).
  const engineSpell = args.spell
    ? { spell: args.spell, runsAs: args.casterEnemyId ? undefined : spellEngineName(args.spell, spellAuthorsFor(campaign)) }
    : "";

  // Resolve targets: each ref may be an enemy or a character, from the id
  // arrays or the comma-separated fallback.
  const enemyTargets: EncounterEnemy[] = [];
  const pcTargets: CharacterSheet[] = [];
  const unmatched: string[] = [];
  const addRef = (ref: string) => {
    const enemy = resolveEnemyRef(encounter.id, ref);
    if (enemy && enemy.status === "alive") {
      if (!enemyTargets.some((entry) => entry.id === enemy.id)) {
        enemyTargets.push(enemy);
      }
      return;
    }
    const sheet = resolveSheetRef(ref, sheets, sheetsById);
    if (sheet) {
      if (!pcTargets.some((entry) => entry.id === sheet.id)) {
        pcTargets.push(sheet);
      }
      return;
    }
    unmatched.push(ref);
  };
  for (const ref of args.enemyIds ?? []) {
    addRef(ref);
  }
  for (const ref of args.characterIds ?? []) {
    addRef(ref);
  }
  for (const ref of (args.targets ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    addRef(ref);
  }
  // The dead are beyond an area's harm: no save, no damage, no condition,
  // and no place on its card (apply_damage refuses them anyway).
  const skippedDead = pcTargets.filter((sheet) => sheet.deathSaves?.dead).map((sheet) => sheet.name);
  if (skippedDead.length) {
    pcTargets.splice(0, pcTargets.length, ...pcTargets.filter((sheet) => !sheet.deathSaves?.dead));
    // A spell that lays its area (a Web over the fallen) is still cast.
    if (!enemyTargets.length && !pcTargets.length && !(args.spell && zoneRowFor(engineSpell))) {
      return { error: `${skippedDead.join(", ")} ${skippedDead.length === 1 ? "is" : "are"} dead; the area catches nobody it can harm. Nothing was spent.` };
    }
  }
  // A creature Blink, Etherealness, Maze or a Resilient Sphere took away is
  // beyond the area's reach, and a caster off the Material Plane reaches
  // nobody (src/lib/dm/spell-planes.ts).
  const awayCaster = args.casterId ? resolveSheetRef(args.casterId, sheets, sheetsById) : null;
  const casterAway = awayCaster ? castingHold(awayCaster) : null;
  if (casterAway) {
    return { error: casterAway };
  }
  const beyondReach = [
    ...enemyTargets.filter((enemy) => outOfReach({ name: enemy.displayName, conditions: enemy.conditions })).map((enemy) => enemy.displayName),
    ...pcTargets.filter((sheet) => outOfReach(sheet)).map((sheet) => sheet.name),
  ];
  if (beyondReach.length) {
    enemyTargets.splice(0, enemyTargets.length, ...enemyTargets.filter((enemy) => !beyondReach.includes(enemy.displayName)));
    pcTargets.splice(0, pcTargets.length, ...pcTargets.filter((sheet) => !beyondReach.includes(sheet.name)));
    if (!enemyTargets.length && !pcTargets.length) {
      return { error: `${beyondReach.join(", ")} ${beyondReach.length === 1 ? "is" : "are"} out of reach of the Material Plane; the area catches nobody. Nothing was spent.` };
    }
  }
  // A Globe of Invulnerability shields the creatures inside it from a spell
  // cast from outside (src/lib/dm/zone-rules.ts); one that catches nobody
  // else is refused before anything is spent.
  const areaCasterRef = args.casterEnemyId ?? args.casterId;
  const shielded: string[] = [];
  if (args.spell && areaCasterRef) {
    const caster = args.casterEnemyId ? resolveEnemyRef(encounter.id, args.casterEnemyId)?.id : resolveSheetRef(args.casterId ?? "", sheets, sheetsById)?.id;
    const guard = (id: string, name: string) => (caster ? globeProblemFor(encounter.id, caster, id, name, args.spell, args.level) : null);
    const blocked = [...enemyTargets.filter((enemy) => guard(enemy.id, enemy.displayName)), ...pcTargets.filter((sheet) => guard(sheet.id, sheet.name))];
    if (blocked.length && blocked.length === enemyTargets.length + pcTargets.length) {
      return { error: guard(blocked[0].id, "displayName" in blocked[0] ? blocked[0].displayName : blocked[0].name) ?? "" };
    }
    for (const entry of blocked) {
      shielded.push("displayName" in entry ? entry.displayName : entry.name);
    }
    enemyTargets.splice(0, enemyTargets.length, ...enemyTargets.filter((enemy) => !blocked.includes(enemy)));
    pcTargets.splice(0, pcTargets.length, ...pcTargets.filter((sheet) => !blocked.includes(sheet)));
  }
  // A spell that only lays its area (an enemy's Darkness, a Web with nobody
  // in it yet) catches nobody (src/lib/dm/zone-cast.ts).
  const areaOnly = Boolean(args.spell && zoneRowFor(engineSpell));
  if (!enemyTargets.length && !pcTargets.length && !areaOnly) {
    return {
      error:
        "aoe_damage needs at least one valid target: enemyIds and/or characterIds from GAME STATE.",
    };
  }

  // SRD 5.1, Charmed: no harmful magic at the charmer (monsters workstream).
  const charmedCaster = args.casterId ? resolveSheetRef(args.casterId, sheets, sheetsById) : null;
  const charmer = charmedCaster
    ? enemyTargets.find((enemy) => charmedBy(charmedCaster.conditions, charmedCaster.conditionMeta, enemy.id))
    : null;
  if (charmedCaster && charmer) {
    return { error: `${charmedCaster.name} is charmed by ${charmer.displayName} and cannot catch it in harmful magic. Nothing was spent; leave it out of the area.` };
  }
  // A named player spell is cast and paid for, and its own numbers apply
  // (src/lib/dm/aoe-spell.ts): the slot, the save, the DC, the dice, the
  // conditions. A spell named with no caster is refused, not cast for free.
  // An enemy's spell (casterEnemyId) keeps the caller's numbers.
  const corrections: string[] = [];
  let plan: AoeSpellPlan | null = null;
  if (args.spell && !args.casterEnemyId) {
    const planned = planAoeSpell(campaign, turn, sheets, sheetsById, {
      encounterId: encounter.id,
      spell: args.spell,
      casterId: args.casterId,
      level: args.level,
      damage: args.damage,
      overchannel: args.overchannel,
      sculpt: args.sculpt,
      ...(args.saveAbility ? { saveAbility: args.saveAbility as SaveAbility } : {}),
      ...(args.dc ? { dc: args.dc } : {}),
      halfOnSave: args.halfOnSave,
      type: args.type,
      reason: args.reason,
      enemies: enemyTargets,
      characters: pcTargets,
      ...zonePlacement(args),
    });
    if ("error" in planned) {
      return planned;
    }
    plan = planned;
    // Prismatic Spray rolls a ray for each creature (prismatic.ts).
    if (isPrismaticSpray(planned.runsAs ?? planned.spell)) {
      const results = castPrismaticSpray({ campaign, turn, caster: planned.caster, dc: planned.dc, enemies: enemyTargets, characters: pcTargets.filter((sheet) => !planned.sculpted.includes(sheet.id)), sheets, sheetsById });
      return { ok: true, spell: planned.spell, caster: planned.caster.name, dc: planned.dc, saveAbility: "dex", results, ...(planned.corrections.length ? { corrected: planned.corrections } : {}), ...(skippedDead.length ? { skippedDead } : {}) };
    }
    // Limited Magic Immunity (the rakshasa): the area washes over it.
    const level = args.level ?? spellFactsFor(planned.spell)?.level ?? 0;
    for (const enemy of [...enemyTargets]) {
      if (magicImmunityProblem(enemy, planned.spell, level)) {
        enemyTargets.splice(enemyTargets.indexOf(enemy), 1);
        corrections.push(`${enemy.displayName} is unaffected: Limited Magic Immunity turns aside spells of its level or lower.`);
      }
    }
    args.damage = planned.damage ?? undefined;
    args.saveAbility = planned.saveAbility;
    args.dc = planned.dc;
    args.halfOnSave = planned.halfOnSave;
    args.type = planned.type;
    corrections.push(...planned.corrections);
  }
  // An enemy's area ability or spell (casterEnemyId) is its action for the
  // round (or the legendary action bought for it) with its block's numbers:
  // the save, DC and dice it prints, its recharge, its spell slots
  // (src/lib/dm/enemy-casting.ts). Only a block that lists nothing keeps the
  // caller's numbers.
  let enemyUse: EnemyUse | null = null;
  if (args.casterEnemyId) {
    const prepared = prepareEnemyUse(campaign, {
      casterEnemyId: args.casterEnemyId,
      ability: args.ability,
      spell: args.spell,
      targetIds: pcTargets.map((sheet) => sheet.id),
      sent: { save: args.saveAbility, dc: args.dc, damage: typeof args.damage === "string" ? args.damage : undefined },
    });
    if ("error" in prepared) {
      return prepared;
    }
    enemyUse = prepared;
    if (prepared.fromBlock) {
      args.damage = prepared.damage;
      args.type = prepared.damageType ?? args.type;
      args.halfOnSave = Boolean(prepared.halfOnSave);
    }
    args.saveAbility = prepared.save ?? args.saveAbility;
    args.dc = prepared.dc ?? args.dc;
    corrections.push(...prepared.corrections);
    if ((!args.saveAbility || !args.dc) && (enemyTargets.length || pcTargets.length)) {
      return { error: `${prepared.enemy.displayName}'s block gives ${prepared.name} no save and DC; send saveAbility and dc with it. Nothing was spent.` };
    }
    if (args.damage === undefined && !prepared.condition && !zoneRowFor(prepared.name)) {
      return { error: `${prepared.name} forces no save with damage or a condition on ${prepared.enemy.displayName}'s block; narrate what it does, or use its attacks.` };
    }
    // One breath, one cone: everyone caught fits one placement of the shape
    // the block prints (src/lib/dm/aoe-shape.ts).
    const area = args.ability ? abilityAreaShape(prepared.enemy.stats, args.ability) : args.spell ? spellAreaShape(args.spell) : null;
    if (area) {
      const problem = areaProblem({
        encounterId: encounter.id,
        casterId: prepared.enemy.id,
        casterName: prepared.enemy.displayName,
        label: prepared.name,
        area,
        rangeFeet: args.spell ? (spellFactsFor(args.spell)?.range.kind === "feet" ? (spellFactsFor(args.spell)?.range as { feet: number }).feet : null) : null,
        creatures: [...enemyTargets.map((enemy) => ({ id: enemy.id, name: enemy.displayName })), ...pcTargets.map((sheet) => ({ id: sheet.id, name: sheet.name }))].filter((entry) => entry.id !== prepared.enemy.id),
        ...zonePlacement(args),
      });
      if (problem) {
        return { error: problem };
      }
    }
    prepared.commit();
  }
  // Every branch above has set the save and the DC by now, or caught nobody
  // who would roll against them (an enemy's Darkness laid on empty ground).
  const saveDc = args.dc ?? 0;
  if (plan?.mech?.hitPointPool) {
    return aoePool(campaign, encounter.id, plan, enemyTargets, corrections);
  }
  if (args.damage === undefined && !plan?.conditions.length && !plan?.mech?.riders && !enemyUse?.condition && !areaOnly) {
    return { error: "aoe_damage needs damage (dice or a number), or a known spell that lays a condition." };
  }

  // The damage rolls once for the whole effect; a spell that deals none
  // rolls nothing and harms nobody. A spell of two damage types rolls each
  // apart (Meteor Swarm: src/lib/dm/aoe-parts.ts).
  let total = 0;
  const rolled: DamagePart[] = [];
  // The roll's card names who made the area and every creature it can harm:
  // not an ally Sculpt Spells shapes it around, and not an enemy whose token
  // the players cannot see (the rule activePublicEncounter applies).
  const map = getBattleMapForEncounter(encounter.id);
  const unseen = map ? listHiddenRefIds(map.id) : [];
  const caught = [
    ...enemyTargets.filter((enemy) => !unseen.includes(enemy.id)).map((enemy) => enemy.displayName),
    ...pcTargets.filter((sheet) => !plan?.sculpted.includes(sheet.id)).map((sheet) => sheet.name),
  ];
  // A character's area that names no spell (a dragonborn's breath) is still
  // theirs. A caster whose token is hidden is not named, as a hidden
  // creature it catches is not (the tracker's word for it).
  const areaBy: RollAttacker | null = plan
    ? { kind: "sheet", id: plan.caster.id, name: plan.caster.name }
    : enemyUse
      ? { kind: "enemy", id: enemyUse.enemy.id, name: unseen.includes(enemyUse.enemy.id) ? "Someone unseen" : enemyUse.enemy.displayName }
      : awayCaster
        ? { kind: "sheet", id: awayCaster.id, name: awayCaster.name }
        : null;
  const areaName = plan ? plan.spell : enemyUse?.name || null;
  if (typeof args.damage === "number") {
    total = args.damage;
  } else if (args.damage) {
    if (!isValidExpression(args.damage)) {
      return { error: `Invalid damage expression "${args.damage}".` };
    }
    const split = splitDamageExpression(args.damage, plan?.mech?.secondType);
    for (const [index, expression] of (split ?? [args.damage]).entries()) {
      const type = index === 0 ? args.type : plan?.mech?.secondType;
      // Elemental Adept: the caster's chosen type floors its dice at 2.
      const adept = plan ? elementalAdeptApplies(plan.caster, type) : false;
      const outcome = rollExpression(adept ? floorDamageDice(expression) : expression);
      rolled.push({ amount: outcome.total, type });
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: null,
        requestedBy: "dm",
        kind: "damage",
        // The type tells a two-type spell's rolls apart, and is all an
        // unnamed effect has.
        detail: rollOn(`${areaName ?? "area effect"}${type && (split || !areaName) ? ` (${type})` : ""}`, caught),
        result: outcome,
        attacker: areaBy,
      });
      turn.rollIds.push(roll.id);
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
        roll,
        source: "digital",
      });
    }
    total = partsTotal(rolled);
  }
  if (args.damage !== undefined && args.damage !== 0 && args.damage !== "0") {
    total = Math.max(1, total + (plan?.flat ?? 0));
  }
  // The blast as it lands: one part, or the first type with the caster's
  // flat bonus and the second type's own roll.
  const blast: DamagePart[] = rolled.length > 1 ? [{ ...rolled[0], amount: total - rolled[1].amount }, rolled[1]] : [{ amount: total, type: args.type }];
  const halfOnSave = args.halfOnSave ?? true;
  const ability = (args.saveAbility ?? "dex") as SaveAbility;
  // What a failed save lays on an enemy, recorded with the spell and caster.
  const conditionMeta = plan?.mech?.condition
    ? spellConditionMeta(
        plan.mech.condition,
        { spell: plan.spell, casterId: plan.caster.id, slotLevel: plan.slotLevel },
        { ability, dc: saveDc },
      )
    : null;

  const results: Array<Record<string, unknown>> = [];
  let encounterOver: Record<string, unknown> = {};

  // Enemy saves roll silently from stat blocks; results ride the table.
  for (const enemy of enemyTargets) {
    // The creature's conditions decide the save as a character's would.
    // Stinking Cloud cannot touch a creature immune to poison.
    const untouched = plan ? spellAutoSave(plan.mech, enemy) : null;
    const save = plan?.noSave || untouched
      ? null
      : rollEnemySave(campaign.id, enemy, ability, saveDc, {
          magical: Boolean(plan) || Boolean(enemyUse?.magical),
          // A legendary creature spends a resistance on an area's binding
          // condition, as it would on one cast at it alone (legendary-logic.ts).
          resist: Boolean(plan?.conditions.length) && bindsWorthResisting(plan?.conditions ?? [], Boolean(plan?.mech?.condition?.endsWith)),
          ...(plan ? spellSaveOptions(plan.mech, enemy) : {}),
          ...(plan ? { record: { turn, detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${plan.spell}` } } : {}),
        });
    const success = untouched ? true : save ? save.success : false;
    const taken = partsTaken(blast, success ? (halfOnSave ? "half" : "none") : "full");
    const damageTaken = partsTotal(taken);
    const row: Record<string, unknown> = {
      target: enemy.displayName,
      ...(!save ? { noSave: true } : save.autoFailed ? { autoFailed: save.notes.join("; ") } : { save: save.total }),
      success,
      damage: damageTaken,
    };
    if (save?.legendaryResistance) {
      row.legendaryResistance = `${enemy.displayName} spends a Legendary Resistance: the failed save becomes a success.`;
    }
    let laid: string[] = [];
    if (!success && plan?.conditions.length) {
      const landed = layAreaConditions(plan, enemy.id, { ability, dc: saveDc });
      laid = landed;
      if (landed.length) {
        row.conditionApplied = landed.join(", ");
        publishEncounter(campaign.id);
      }
    }
    const hpBefore = enemy.currentHp;
    // Each damage type lands on its own, meeting its own resistance.
    for (const part of taken.filter((entry) => entry.amount > 0)) {
      const now = getEnemy(enemy.id) ?? enemy;
      if (now.status !== "alive") {
        break;
      }
      const applied = applyEnemyDamage(
        campaign,
        turn,
        encounter,
        now,
        part.amount,
        sheets,
        sheetsById,
        part.type,
        plan ? { magical: true, ...(elementalAdeptApplies(plan.caster, part.type) ? { ignoreResistance: true } : {}) } : undefined,
      );
      if (applied.damageNote) {
        row.note = [row.note, applied.damageNote].filter(Boolean).join(" ");
      }
      row.health = applied.health;
      if (applied.dead) {
        row.dead = true;
      }
      if (applied.encounterOver) {
        encounterOver = {
          encounterOver: true,
          outcome: applied.outcome,
          ...(applied.xpAwarded ? { xpAwarded: applied.xpAwarded } : {}),
        };
      }
    }
    // What the failure cost, so legendary_resist can settle it as a success
    // (src/lib/dm/legendary-tools.ts): the conditions and the hit points a
    // success would have spared.
    if (save && !success) {
      const lost = Math.max(0, hpBefore - (getEnemy(enemy.id)?.currentHp ?? hpBefore));
      settleFailedSave(campaign.id, enemy.id, {
        conditions: laid,
        ...(plan ? { spell: plan.spell, source: plan.caster.id } : {}),
        refund: halfOnSave ? lost - Math.floor(lost / 2) : lost,
      });
    }
    // Bestow Curse's necrotic on its caster's spell (src/lib/dm/spell-retort.ts).
    const cursed = plan && damageTaken > 0 && !row.dead ? curseBurn(campaign, turn, enemy.id, plan.caster.id, sheets, sheetsById) : null;
    if (cursed) {
      row.curse = cursed;
    }
    // A push, a lost action, Divine Word's tiers (src/lib/dm/spell-riders.ts).
    if (plan) {
      const effects = afterEnemySave({
        campaign,
        turn,
        mech: plan.mech,
        spell: plan.spell,
        caster: plan.caster,
        enemy,
        saved: success,
        taken: Math.max(0, hpBefore - (getEnemy(enemy.id)?.currentHp ?? hpBefore)),
        dc: saveDc,
        sheets,
        sheetsById,
      });
      if (effects.length) {
        row.effects = effects;
      }
    }
    if (untouched) {
      row.note = untouched;
    }
    results.push(row);
  }

  // Character saves use real sheet modifiers and publish dice cards; the
  // damage rides apply_damage so audit, undo, and the death engine apply
  // (src/lib/dm/aoe-characters.ts).
  results.push(
    ...aoeOnCharacters({
      campaign,
      turn,
      pcTargets,
      plan,
      enemyUse,
      conditionMeta,
      ability,
      dc: saveDc,
      halfOnSave,
      blast,
      total,
      type: args.type,
      spell: args.spell,
      reason: args.reason,
      sheets,
      sheetsById,
    }),
  );

  // Sleet Storm: whoever concentrates in it saves or loses the spell.
  const shaken = plan
    ? concentrationShaken(campaign, turn, plan.mech, saveDc, { enemies: enemyTargets, characters: pcTargets.filter((sheet) => !plan?.sculpted.includes(sheet.id)) })
    : [];

  // Casting an area spell is the character's action, not their whole turn:
  // a human caster may still move or use a bonus action, so only end_turn
  // advances past them. Companion casters resolve here so the auto-act
  // backstop cannot act them a second time.
  if (args.casterId) {
    const caster = resolveSheetRef(args.casterId, sheets, sheetsById);
    if (caster?.isCompanion && !turn.resolvedCharacterIds.includes(caster.id)) {
      turn.resolvedCharacterIds.push(caster.id);
    }
  }

  // An enemy ability's condition (Frightful Presence, Wing Attack's prone)
  // lands on each character who failed, tied to the creature so it ends
  // with it; a repeatable save re-rolls each round.
  if (enemyUse?.condition) {
    for (const sheet of pcTargets) {
      const row = results.find((entry) => entry.target === sheet.name);
      const standing = getSheetById(sheet.id);
      if (!row || row.success || !standing || standing.currentHp <= 0) {
        continue;
      }
      const applied = layEnemyCondition(
        campaign,
        turn,
        sheet,
        enemyUse,
        enemyUse.condition,
        { ability, dc: saveDc },
        { rounds: enemyUse.rounds, saveEnds: Boolean(enemyUse.saveEnds) },
        `${enemyUse.enemy.displayName}'s ${enemyUse.name}`,
        sheets,
        sheetsById,
      );
      if (!("error" in applied)) {
        row.conditionApplied = enemyUse.condition;
      }
    }
  }
  // An enemy caster's concentration spell (Web, Cloud of Daggers) is
  // tracked so damage to the caster can end the effect.
  const enemyConcentration =
    trackEnemyConcentration(campaign, args.casterEnemyId, enemyUse?.spell ?? args.spell) ??
    (enemyUse && args.spell ? holdEnemyAreaConcentration(campaign, enemyUse.enemy.id, enemyUse.name) : null);
  // The spell's area on the board, where it was cast (src/lib/dm/zone-cast.ts).
  const areaCaster = plan ? { kind: "pc" as const, id: plan.caster.id, name: plan.caster.name } : enemyUse && args.spell ? { kind: "enemy" as const, id: enemyUse.enemy.id, name: enemyUse.enemy.displayName } : null;
  const area = areaCaster ? placeSpellZone(campaign, { spell: plan?.spell ?? enemyUse?.name ?? "", runsAs: plan?.runsAs, caster: areaCaster, slotLevel: plan?.slotLevel, dc: saveDc, caught: [...enemyTargets.map((enemy) => enemy.id), ...pcTargets.map((sheet) => sheet.id)], ...zonePlacement(args) }) : null;

  return {
    ok: true,
    ...(plan ? { spell: plan.spell, caster: plan.caster.name } : {}),
    ...(plan?.mech?.note ? { spellNote: plan.mech.note } : {}),
    ...(shaken.length ? { concentration: shaken } : {}),
    damageRolled: total,
    dc: saveDc,
    saveAbility: ability,
    halfOnSave,
    results,
    ...(corrections.length ? { corrected: corrections } : {}),
    ...(unmatched.length ? { unmatchedTargets: unmatched } : {}),
    ...(skippedDead.length ? { skippedDead } : {}),
    ...(enemyConcentration ? { enemyConcentration } : {}),
    ...(area ? { area } : {}),
    ...(beyondReach.length ? { outOfReach: `${beyondReach.join(", ")} ${beyondReach.length === 1 ? "is" : "are"} off the Material Plane; the spell does not touch them.` } : {}),
    ...(shielded.length ? { globeShielded: `${shielded.join(", ")} stand inside a Globe of Invulnerability; the spell has no effect on them.` } : {}),
    ...encounterOver,
  };
}
