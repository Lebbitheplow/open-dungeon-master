// cast_at_enemy: a save or automatic spell a player casts at ONE enemy. The
// server spends the slot through the one cast guard, rolls the enemy's save
// from its block against the caster's DC, and applies the damage and the
// spell's conditions, each recording the spell and its caster
// (spell-effects.ts). An area or multi-target spell may be resolved one enemy
// per call in the same turn for one slot (cast-guard.ts open casts). Split out
// of cast-tools.ts, which re-exports it; this module imports mutations (for
// the slot spend) and must never be imported by it.

import { z } from "zod";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { zoneArgsSchema, zonePlacement } from "@/lib/dm/zone-args";
import { autoLegendaryResistance } from "@/lib/dm/legendary-tools";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, recordEncounterTarget } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression } from "@/lib/dice";
import { spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { castRedirect } from "@/lib/dm/cast-redirect";

export { castRedirect };
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { conditionUntargetable } from "@/lib/srd/condition-effect-queries";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { planSpellFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { landSpellDamage } from "@/lib/dm/cast-at-enemy-damage";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
// What the spell does beyond damage and condition (src/lib/dm/spell-riders.ts).
import { afterEnemySave, chosenCondition, conditionMetaFor, heatMetalGrip } from "@/lib/dm/spell-riders";
import { layOnEnemy, spellAutoSave, spellSaveOptions, turnEndMark } from "@/lib/dm/spell-riders";
import { sleepPool } from "@/lib/dm/spell-pool";
import { handleDispelMagic } from "@/lib/dm/dispel";
import { overchannelProblem, payOverchannel } from "@/lib/dm/caster-features";
import { maximumOf } from "@/lib/dm/heal-spell";
import { castingHold } from "@/lib/dm/spell-planes";
import { castShapeAtEnemy, enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph";

const castArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string(),
  spell: z.string().max(80),
  saveAbility: z.preprocess(normalizeAbility, z.enum(["str", "dex", "con", "int", "wis", "cha"])).optional(),
  level: z.coerce.number().int().min(1).max(9).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  // Magic Missile: how many of the casting's darts strike this target.
  darts: z.coerce.number().int().min(1).max(20).optional(),
  // Dispel Magic: the spell to end on the target, when it holds several.
  endSpell: z.string().max(80).optional(),
  // A wizard's Overchannel: the spell's maximum damage (caster-features.ts).
  overchannel: z.coerce.boolean().optional(),
  // Polymorph and True Polymorph: the beast the creature becomes.
  variant: z.string().max(40).optional(),
  reason: z.string().optional(),
  ...zoneArgsSchema,
});

export function handleCastAtEnemy(
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
  let args: z.infer<typeof castArgsSchema>;
  try {
    args = castArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: cast_at_enemy needs characterId, targetEnemyId, spell, and saveAbility.",
    };
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
  // Multiclass: the DC follows the class whose list carries the spell.
  const dc = spellSaveDcFor(sheet, args.spell ?? "");
  if (dc === null) {
    return { error: `${sheet.name} has no spell save DC.` };
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId);
  if (!enemy) {
    return { error: "Unknown targetEnemyId; use one from GAME STATE." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}.` };
  }
  // SRD 5.1, Charmed: no harmful magic at the charmer (monsters workstream).
  if (charmedBy(sheet.conditions, sheet.conditionMeta, enemy.id)) {
    return { error: `${sheet.name} is charmed by ${enemy.displayName} and cannot target it with harmful magic. Nothing was spent; pick another target.` };
  }
  // A caster Etherealness or Maze took away reaches nobody here (spell-planes.ts).
  const away = castingHold(sheet);
  if (away) {
    return { error: away };
  }
  const sealed = conditionUntargetable(enemy.conditions);
  if (sealed) {
    return { error: `${enemy.displayName} is ${sealed} and nothing from outside reaches it until the spell ends. Nothing was spent.` };
  }
  if (enemy.conditions.includes("banished")) {
    return { error: `${enemy.displayName} is banished to another plane and cannot be targeted until the spell ends. Nothing was spent.` };
  }
  // The content pack decides how a known spell resolves; the model's
  // arguments are corrected rather than trusted. Unknown spells resolve only
  // when the table's own homebrew defines them (src/lib/dm/spell-authors.ts).
  const authors = spellAuthorsFor(campaign);
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userIds: authors });
  if (resolvedMech?.mech.dispel) {
    return handleDispelMagic(campaign, turn, sheets, sheetsById, {
      caster: sheet,
      spell: resolvedMech.name,
      level: args.level,
      target: { kind: "enemy", id: enemy.id },
      endSpell: args.endSpell,
      reason: args.reason,
    });
  }
  // Polymorph and True Polymorph: the beast in variant (enemy-polymorph.ts).
  // A table's workshop copy turns its target by the spell it runs as.
  if (resolvedMech && enemyShapeSpellFor(resolvedMech.runsAs ?? resolvedMech.name)) {
    const spell = resolvedMech.name;
    const spend = (cast: Record<string, unknown>) => applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify(cast), sheets, sheetsById).result;
    return castShapeAtEnemy(campaign, turn, { caster: sheet, enemy, spell, runsAs: resolvedMech.runsAs, variant: args.variant, level: args.level, reason: args.reason, authors }, spend);
  }
  const redirect = castRedirect(resolvedMech, "save");
  if (redirect) {
    return { error: redirect };
  }
  const facts = spellFactsFor(args.spell, authors);
  const mech = resolvedMech?.mech ?? null;
  const corrections: string[] = [];
  if (!mech?.save && !args.saveAbility && mech?.resolution !== "auto") {
    return { error: "cast_at_enemy needs saveAbility for a spell the server does not know." };
  }
  let ability = (mech?.save ?? args.saveAbility ?? "wis") as SaveAbility;
  if (mech?.save && args.saveAbility && mech.save !== args.saveAbility) {
    corrections.push(
      `${resolvedMech?.name} forces a ${mech.save.toUpperCase()} save, not ${args.saveAbility.toUpperCase()}; the server rolled the real one.`,
    );
    ability = mech.save;
  }
  const autoHit = mech?.resolution === "auto";
  const pool = mech?.hitPointPool ?? null;
  const halfOnSave = mech ? Boolean(mech.halfOnSave) : Boolean(args.halfOnSave);
  if (mech && args.halfOnSave !== undefined && Boolean(args.halfOnSave) !== Boolean(mech.halfOnSave) && !autoHit) {
    corrections.push(
      mech.halfOnSave
        ? "A successful save halves the damage (the pack says so)."
        : "A successful save means no effect (the pack says so).",
    );
  }
  const damageType = mech?.damageType ?? args.damageType;
  const spellName = resolvedMech?.name ?? facts?.name ?? args.spell;
  const spellLevel = resolvedMech?.spellLevel ?? facts?.level ?? 1;
  // What the spell rolls from the slot the caller named; checked here so a
  // cast that could not resolve spends nothing. A spell that deals no damage
  // takes none, whatever dice the caller sends.
  const named = spellDamageFor({
    spell: args.spell,
    userIds: authors,
    casterLevel: sheet.level,
    slotLevel: args.level,
    ...(args.darts ? { darts: args.darts } : {}),
  });
  const callerDice = mech?.noDamage ? undefined : args.damage;
  // The spell's own condition wins over the model's guess; the caster
  // chooses among a spell's variants (Blindness/Deafness).
  const mechCondition = mech?.condition ?? null;
  const wanted = args.condition ? canonicalCondition(args.condition) : null;
  // Command's word, Eyebite's form: the caller's pick among what the spell
  // offers (src/lib/dm/spell-riders.ts).
  const picked = mechCondition ? chosenCondition(mechCondition, args.condition ?? null) : null;
  const conditions = pool
    ? [canonicalCondition(pool.condition)]
    : picked
      ? [canonicalCondition(picked.name), ...(mechCondition?.also ?? []).map(canonicalCondition), ...picked.extra]
      : wanted
        ? [wanted]
        : [];
  if (!pool && !(named?.dice ?? callerDice) && !conditions.length && !mech?.riders) {
    return { error: "cast_at_enemy needs damage and/or condition; otherwise nothing happens." };
  }
  const guessed = named?.dice ?? callerDice;
  if (guessed && !isValidExpression(guessed)) {
    return { error: `Invalid damage expression "${guessed}".` };
  }
  const pickedWord = picked && (picked.extra.length || picked.name !== mechCondition?.name);
  if (mechCondition && wanted && !conditions.includes(wanted) && !pickedWord) {
    corrections.push(
      `${resolvedMech?.name} applies ${conditions.join(" and ")}, not ${args.condition}; the server used the real one.`,
    );
  }
  const main = conditions[0] ?? null;
  // Suggestion and Irresistible Dance hold nothing that cannot be charmed.
  const immuneTo = [main, mech?.immuneIfImmuneTo].find(
    (name): name is string => Boolean(name && enemy.stats.conditionImmune.toLowerCase().includes(name)),
  );
  if (immuneTo && !pool) {
    return {
      error: `${enemy.displayName} is immune to ${immuneTo} (immunities: ${enemy.stats.conditionImmune}); the spell cannot take hold. The slot was not spent.`,
    };
  }
  // Hold Person holds a humanoid and nothing else; Command does nothing to
  // the undead.
  const creatureType = (enemy.stats.type ?? "").toLowerCase();
  // A stat block that names no type is not refused on a guess.
  if (creatureType && mech?.targetTypes?.length && !mech.targetTypes.some((type) => creatureType.includes(type))) {
    return {
      error: `${spellName} affects only ${mech.targetTypes.join(" or ")} creatures, and ${enemy.displayName} is ${creatureType ? `a ${creatureType}` : "not one"}. The slot was not spent; pick another target or another spell.`,
    };
  }
  if (creatureType && mech?.immuneTypes?.some((type) => creatureType.includes(type))) {
    return {
      error: `${spellName} has no effect on ${creatureType} creatures, and ${enemy.displayName} is one. The slot was not spent; pick another target or another spell.`,
    };
  }
  if (args.overchannel) {
    const problem = overchannelProblem(sheet, facts, Boolean(named?.dice ?? callerDice));
    if (problem) {
      return { error: `${problem} Nothing was spent.` };
    }
  }
  const reach = spellReachProblem({
    encounterId: encounter.id,
    casterId: sheet.id,
    casterName: sheet.name,
    targetId: enemy.id,
    targetName: enemy.displayName,
    facts,
  });
  if (reach) {
    return { error: reach };
  }

  // The cast itself, through the one guard (src/lib/dm/cast-guard.ts): who
  // may cast, what they hold, the slot of the spell's own level when none is
  // named, the turn, the material and concentration. A refusal refuses.
  const cast = applyDmMutation(
    campaign,
    turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: sheet.id,
      spell: args.spell,
      ...(args.level ? { level: args.level } : {}),
      // Magic Missile: the darts named, or every dart the casting holds.
      ...(mech?.darts ? { uses: args.darts ?? 20 } : {}),
      via: "enemy",
      reason: (args.reason ?? "").slice(0, 200),
    }),
    sheets,
    sheetsById,
  ).result;
  if ("error" in cast) {
    return cast;
  }
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : undefined;
  // The darts this call throws: what the casting still held, in a fight.
  const darts = mech?.darts && typeof cast.uses === "number" ? cast.uses : args.darts;
  const scaled =
    slotLevel === args.level && darts === args.darts
      ? named
      : spellDamageFor({
          spell: args.spell,
          userIds: authors,
          casterLevel: sheet.level,
          slotLevel,
          ...(darts ? { darts } : {}),
        });
  const base: Record<string, unknown> = {
    spell: spellName,
    caster: sheet.name,
    target: enemy.displayName,
    ...(cast.cost ? { cost: cast.cost } : {}),
    ...(cast.slot ? { slot: cast.slot } : {}),
    ...(cast.repeat ? { repeat: cast.repeat } : {}),
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
    ...(cast.shares ? { shares: cast.shares } : {}),
    ...(cast.continuing ? { continuing: cast.continuing } : {}),
  };
  const source = { spell: spellName, casterId: sheet.id, slotLevel: slotLevel ?? null };

  if (pool) {
    return {
      ...base,
      ...sleepPool(campaign, encounter.id, sheet, enemy, spellName, pool, {
        spellLevel,
        slotLevel: slotLevel ?? spellLevel,
        continuing: Boolean(cast.continuing),
        source,
        note: mech?.note,
      }),
    };
  }
  let damageExpression = mech?.noDamage ? undefined : (scaled?.dice ?? args.damage);
  // Overchannel: the dice at their maximum, and its price after the cast.
  if (args.overchannel && damageExpression) {
    damageExpression = String(maximumOf(damageExpression));
    base.overchannel = payOverchannel(campaign, turn, sheet.id, spellLevel);
  }

  // The enemy's save, from its real stat block with its conditions and
  // lasting effects (src/lib/dm/forced-save.ts). Auto-hit spells (Magic
  // Missile, Heat Metal) and spells that allow none (Power Word Stun) skip it.
  let saved = false;
  const noSave = autoHit || Boolean(mechCondition?.noInitialSave) || mechCondition?.hpAtMost !== undefined;
  // Stinking Cloud cannot touch a creature immune to poison.
  const untouched = spellAutoSave(mech, enemy);
  if (noSave) {
    base.autoHit = true;
  } else if (untouched) {
    saved = true;
    Object.assign(base, { saved: true, dc, note: untouched });
  } else {
    const save = rollEnemySave(campaign.id, enemy, ability, dc, {
      magical: true,
      ...spellSaveOptions(mech, enemy),
      record: { turn, detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${spellName}` },
    });
    saved = save.success;
    Object.assign(base, {
      ...(save.autoFailed ? { autoFailed: save.notes.join("; ") } : { save: save.total }),
      dc,
      saved,
      ...(save.notes.length && !save.autoFailed ? { saveNotes: save.notes } : {}),
    });
  }
  if (corrections.length) {
    base.corrected = corrections;
  }
  const beyondReach = mechCondition?.hpAtMost !== undefined && enemy.currentHp > mechCondition.hpAtMost;
  if (beyondReach) {
    base.note = `${enemy.displayName} has more than ${mechCondition?.hpAtMost} hit points; ${spellName} has no effect on it.`;
  }

  const hpBefore = enemy.currentHp;
  // The dice, the riders, the save's share and the kill (cast-at-enemy-damage.ts).
  const damageDealt = damageExpression
    ? landSpellDamage({
        campaign,
        turn,
        encounter,
        sheet,
        enemy,
        spell: args.spell,
        spellName,
        authors,
        mech,
        facts,
        scaled,
        damageExpression,
        damageType,
        spellLevel,
        halfOnSave,
        saved,
        base,
        sheets,
        sheetsById,
      })
    : 0;

  // The beam and burst on the board, coloured by the damage type, and the
  // target line for the round. Nothing to draw without a board.
  {
    const from = tokenPosition(campaign.id, sheet.id);
    const to = tokenPosition(campaign.id, enemy.id);
    if (from && to) {
      recordEncounterTarget(encounter.id, encounter.round, sheet.id, enemy.id);
      publishFx(
        campaign.id,
        planSpellFx({
          from: from.at,
          to: to.at,
          fromTokenId: from.tokenId,
          toTokenId: to.tokenId,
          resolution: autoHit ? "auto" : "save",
          saved,
          halfOnSave,
          ...(damageDealt > 0 ? { damage: damageDealt } : {}),
          ...(damageType ? { damageType } : {}),
          secretNumbers: true,
        }),
      );
    }
  }

  // A legendary creature shrugs off a failed save that would bind it
  // (docs/vtt-parity-implementation-plan.md 4.1) while it has resistance
  // left; the count is the DM's to see on the tracker.
  const binds = conditions.length && !saved && !beyondReach && !base.dead && !base.encounterOver;
  // Heat Metal: the object held or worn (src/lib/dm/spell-riders.ts).
  const grip = autoHit && !base.dead ? heatMetalGrip(campaign, turn, mech, enemy, source, dc, /armou?r|worn|wear/i.test(args.condition ?? "")) : null;
  if (grip) {
    base.grip = grip;
  }
  if (binds && !noSave) {
    const liveEncounter = getActiveEncounter(campaign.id);
    const liveEnemy = liveEncounter ? resolveEnemyRef(liveEncounter.id, enemy.id) : null;
    if (liveEncounter && liveEnemy && autoLegendaryResistance(campaign, liveEncounter, liveEnemy)) {
      saved = true;
      base.saved = true;
      base.legendaryResistance = "spent: the failed save becomes a success";
    }
  }
  if (binds && !saved) {
    const rounds = mechCondition ? undefined : args.rounds;
    const meta = mechCondition
      ? conditionMetaFor(mechCondition, picked?.rules ?? {}, source, { ability, dc }, enemy.id)
      : spellConditionMeta({ rounds, saveEnds: !rounds }, source, { ability, dc });
    // A word's extra condition lasts as that condition does, not as the
    // spell: Grovel's prone until it stands, Halt's stop to the end of the
    // creature's next turn.
    const entries: Array<[string, typeof meta]> = conditions.map((name) =>
      picked?.extra.includes(name)
        ? [name, { spell: source.spell, source: source.casterId, ...(name === "halted" ? { untilTurnEndOf: enemy.id } : {}) }]
        : [name, meta],
    );
    const mark = turnEndMark(mechCondition ?? undefined, source, enemy.id);
    const landed = layOnEnemy(enemy.id, mark ? [...entries, mark] : entries).filter((name) => name !== mark?.[0]);
    if (landed.length) {
      publishEncounter(campaign.id);
      base.conditionApplied = landed.join(", ");
      const summary = conditionEffectsFor(landed[0])?.summary;
      if (summary) {
        base.conditionEffect = summary;
      }
      base.duration = meta.saveEnds
        ? `until it succeeds on a ${ability.toUpperCase()} save (DC ${dc}) at the end of a round`
        : meta.rounds
          ? `${meta.rounds} round${meta.rounds === 1 ? "" : "s"}`
          : "until the spell ends";
    }
  }
  if (saved && main && !untouched) {
    base.note = `${enemy.displayName} resists: no ${main}.`;
  }
  // What a failed save leaves beyond damage and condition: a push, a
  // shrunken maximum, a lost action, Divine Word's tiers.
  const aftermath = afterEnemySave({
    campaign,
    turn,
    mech,
    spell: spellName,
    caster: sheet,
    enemy,
    saved: saved || beyondReach,
    taken: Math.max(0, hpBefore - (getEnemy(enemy.id)?.currentHp ?? hpBefore)),
    dc,
    sheets,
    sheetsById,
  });
  if (aftermath.length) {
    base.effects = aftermath;
  }
  if (mech?.note) {
    base.spellNote = mech.note;
  }
  // A spell that stays on the ground is laid around its target (src/lib/dm/zone-cast.ts).
  // A later share of the same casting (a second creature in the web) leaves it where it is.
  const area = cast.continuing ? null : placeSpellZone(campaign, { spell: spellName, runsAs: resolvedMech?.runsAs ?? facts?.runsAs, caster: { kind: "pc", id: sheet.id, name: sheet.name }, slotLevel: slotLevel ?? null, dc, caught: [enemy.id], ...zonePlacement(args) });
  return { ok: true, ...base, ...(area ? { area } : {}) };
}
