import { z } from "zod";
import { autoLegendaryResistance } from "@/lib/dm/legendary-tools";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions, setEnemyConcentration } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression, rollExpression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellFactsFor, spellMechanicsFor, type ResolvedSpellMech } from "@/lib/content";
import { findBeastForm, formatCr } from "@/lib/srd/beast-forms";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { recordEncounterTarget, type EncounterEnemy } from "@/lib/db/encounters";
import { planSpellFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { castShares, type SpellMech } from "@/lib/srd/spell-mechanics";
import { addDice } from "@/lib/srd/spell-scaling";

// cast_at_enemy: single-target save-or-suffer spells a player casts on an
// enemy (Hold Person, Tasha's Hideous Laughter, single-target Poison
// Spray...). The server spends the slot, derives the save DC from the
// caster's sheet, rolls the enemy's save from its real stat block, and
// applies the damage and/or condition (with duration) on a failure, so the
// model never adjudicates these. Multi-target effects stay on aoe_damage;
// attack-roll spells stay on pc_attack. This module imports mutations (for
// the slot spend) and must never be imported by it.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const castAtPlayerTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_player",
    description:
      "An enemy or hazard forces a saving throw on ONE character (a hag's Hold Person, a trap's poison needle, a curse). The server rolls that character's save from their real sheet, applies the damage and/or condition on a failure, and reports it. Use aoe_damage when several characters are caught, and never apply a condition to a character with set_condition when a save should have decided it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        source: { type: "string", description: "What forces the save, e.g. 'the hag's Hold Person'." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "The save the effect forces.",
        },
        dc: { type: "integer", minimum: 1, maximum: 30, description: "The save DC." },
        damage: {
          type: "string",
          description: "Damage dice on a failed save, e.g. '3d6'. Omit for pure-condition effects.",
        },
        damageType: { type: "string", description: "Damage type, e.g. poison." },
        halfOnSave: {
          type: "boolean",
          description: "True = half damage on a successful save (default false: no effect).",
        },
        condition: { type: "string", description: "Condition applied on a failed save." },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "How long the condition lasts. Omit for save-ends: they re-save each round.",
        },
        casterEnemyId: {
          type: "string",
          description:
            "When a specific enemy casts this: its enemyId from GAME STATE. With spell set, the server tracks the enemy's concentration and breaks it (ending the effect) when the enemy takes damage or dies.",
        },
        spell: {
          type: "string",
          description: "The spell the enemy casts, e.g. 'Hold Person'; enables concentration tracking.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "saveAbility", "dc"],
    },
  },
};

export const castAtEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_enemy",
    description:
      "A player casts a saving-throw spell at ONE enemy (Hold Person, Bane on a single target, a single-target poison...). The server spends the slot, derives the save DC from the caster's sheet, rolls the enemy's save from its real stats, and applies the damage and/or condition on a failure. Use aoe_damage for multi-target effects and pc_attack for attack-roll spells.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        spell: { type: "string", description: "Exact spell name from the caster's list." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "The save the spell forces.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend. Omit for cantrips.",
        },
        damage: {
          type: "string",
          description: "Damage dice on a failed save, e.g. '3d8'. Omit for pure-condition spells.",
        },
        damageType: { type: "string", description: "Damage type, e.g. psychic." },
        halfOnSave: {
          type: "boolean",
          description: "True = half damage on a successful save (default false: no effect).",
        },
        condition: {
          type: "string",
          description: "Condition applied on a failed save, e.g. paralyzed.",
        },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "How many rounds the condition lasts. Omit for save-ends: the enemy re-saves at the end of each round.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "targetEnemyId", "spell", "saveAbility"],
    },
  },
};

// The redirect a mis-aimed cast gets when the content pack knows how the
// spell actually resolves. Null = this tool is the right one.
export function castRedirect(
  resolved: ResolvedSpellMech | null,
  expected: "save" | "buff" | "attack",
): string | null {
  if (!resolved || resolved.mech.resolution === expected) {
    return null;
  }
  const { name, mech } = resolved;
  switch (mech.resolution) {
    case "attack":
      return `${name} is an attack-roll spell; resolve it with pc_attack (spell="${name}").`;
    case "save":
      return `${name} forces a saving throw; resolve it with cast_at_enemy (or aoe_damage for several targets).`;
    case "buff":
      return `${name} grants an effect, it forces no save; cast it with cast_buff.`;
    case "heal":
      return `${name} heals; resolve it with heal (spell="${name}", casterId, and the slot level): the server spends the slot and rolls the dice.`;
    case "summon":
      return `${name} conjures creatures; spend the slot with use_spell_slot and bring them in with add_enemies or add_companion.`;
    case "auto":
      // Magic Missile through cast_at_enemy is tolerated: no save rolls.
      return expected === "save" ? null : `${name} hits automatically; resolve it with cast_at_enemy.`;
    case "utility":
      return `${name} has no attack, save, damage, or buff to resolve; spend the slot with use_spell_slot and narrate its effect.`;
  }
}

const castArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string(),
  spell: z.string().max(80),
  saveAbility: z.preprocess(normalizeAbility, z.enum(["str", "dex", "con", "int", "wis", "cha"])),
  level: z.coerce.number().int().min(1).max(9).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  reason: z.string().optional(),
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
  // The content pack decides how a known spell resolves; the model's
  // arguments are corrected rather than trusted. Unknown spells resolve only
  // when the table's own homebrew defines them (src/lib/dm/spell-authors.ts).
  const authors = spellAuthorsFor(campaign);
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userIds: authors });
  const redirect = castRedirect(resolvedMech, "save");
  if (redirect) {
    return { error: redirect };
  }
  const facts = spellFactsFor(args.spell, authors);
  const mech = resolvedMech?.mech ?? null;
  const corrections: string[] = [];
  let ability = args.saveAbility as SaveAbility;
  if (mech?.save && mech.save !== args.saveAbility) {
    corrections.push(
      `${resolvedMech?.name} forces a ${mech.save.toUpperCase()} save, not ${args.saveAbility.toUpperCase()}; the server rolled the real one.`,
    );
    ability = mech.save;
  }
  const autoHit = mech?.resolution === "auto";
  const pool = mech?.hitPointPool ?? null;
  const halfOnSave = mech ? Boolean(mech.halfOnSave) : Boolean(args.halfOnSave);
  if (mech && Boolean(args.halfOnSave) !== Boolean(mech.halfOnSave) && !autoHit) {
    corrections.push(
      mech.halfOnSave
        ? "A successful save halves the damage (the pack says so)."
        : "A successful save means no effect (the pack says so).",
    );
  }
  const damageType = mech?.damageType ?? args.damageType;
  const spellName = resolvedMech?.name ?? facts?.name ?? args.spell;
  // What the spell rolls from the slot the caller named; checked here so a
  // cast that could not resolve spends nothing.
  const named = spellDamageFor({
    spell: args.spell,
    userIds: authors,
    casterLevel: sheet.level,
    slotLevel: args.level,
  });
  if (!pool && !(named?.dice ?? args.damage) && !args.condition && !mech?.condition) {
    return { error: "cast_at_enemy needs damage and/or condition; otherwise nothing happens." };
  }
  const guessed = named?.dice ?? args.damage;
  if (guessed && !isValidExpression(guessed)) {
    return { error: `Invalid damage expression "${guessed}".` };
  }
  // The pack's condition wins over the model's guess; its duration comes
  // with it (save-ends unless the pack states rounds).
  const mechCondition = mech?.condition ?? null;
  const condition = pool
    ? canonicalCondition(pool.condition)
    : mechCondition
      ? canonicalCondition(mechCondition.name)
      : args.condition
        ? canonicalCondition(args.condition)
        : null;
  if (mechCondition && args.condition && canonicalCondition(args.condition) !== condition) {
    corrections.push(
      `${resolvedMech?.name} applies ${condition}, not ${args.condition}; the server used the real one.`,
    );
  }
  const conditionRounds = pool
    ? pool.rounds
    : mechCondition
      ? (mechCondition.saveEnds ? undefined : mechCondition.rounds)
      : args.rounds;
  if (condition && enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return {
      error: `${enemy.displayName} is immune to ${condition} (immunities: ${enemy.stats.conditionImmune}); the spell cannot take hold. The slot was not spent.`,
    };
  }
  // Hold Person holds a humanoid and nothing else.
  const creatureType = (enemy.stats.type ?? "").toLowerCase();
  // A stat block that names no type is not refused on a guess.
  if (creatureType && mech?.targetTypes?.length && !mech.targetTypes.some((type) => creatureType.includes(type))) {
    return {
      error: `${spellName} affects only ${mech.targetTypes.join(" or ")} creatures, and ${enemy.displayName} is ${creatureType ? `a ${creatureType}` : "not one"}. The slot was not spent; pick another target or another spell.`,
    };
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
  const scaled =
    slotLevel === args.level
      ? named
      : spellDamageFor({ spell: args.spell, userIds: authors, casterLevel: sheet.level, slotLevel });
  const damageExpression = pool ? undefined : (scaled?.dice ?? args.damage);

  if (pool) {
    return sleepPool(campaign, encounter.id, enemy, spellName, pool, {
      spellLevel: resolvedMech?.spellLevel ?? facts?.level ?? 1,
      slotLevel: slotLevel ?? resolvedMech?.spellLevel ?? 1,
      caster: sheet.name,
      condition: condition ?? "unconscious",
      note: mech?.note,
    });
  }

  // The enemy's save, from its real stat block with its conditions and
  // lasting effects (src/lib/dm/forced-save.ts). Auto-hit spells (Magic
  // Missile) skip the save entirely.
  let saved = false;
  const base: Record<string, unknown> = {
    spell: spellName,
    caster: sheet.name,
    target: enemy.displayName,
    ...(cast.cost ? { cost: cast.cost } : {}),
    ...(cast.slot ? { slot: cast.slot } : {}),
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
    ...(cast.shares ? { shares: cast.shares } : {}),
    ...(cast.continuing ? { continuing: cast.continuing } : {}),
  };
  if (autoHit) {
    base.autoHit = true;
  } else {
    const save = rollEnemySave(campaign.id, enemy, ability, dc);
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

  let damageDealt = 0;
  if (damageExpression) {
    const outcome = rollExpression(damageExpression);
    damageDealt = saved ? (halfOnSave ? Math.floor(outcome.total / 2) : 0) : outcome.total;
    if (damageDealt > 0) {
      const applied = applyEnemyDamage(
        campaign,
        turn,
        encounter,
        enemy,
        damageDealt,
        sheets,
        sheetsById,
        damageType,
      );
      Object.assign(base, {
        damage: damageDealt,
        ...(damageType ? { damageType } : {}),
        ...(scaled ? { scaling: scaled.note } : {}),
        ...applied,
      });
    } else {
      base.damage = 0;
    }
  }

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
  if (condition && !saved && !autoHit && !base.dead && !base.encounterOver) {
    const liveEncounter = getActiveEncounter(campaign.id);
    const liveEnemy = liveEncounter ? resolveEnemyRef(liveEncounter.id, enemy.id) : null;
    if (liveEncounter && liveEnemy && autoLegendaryResistance(campaign, liveEncounter, liveEnemy)) {
      saved = true;
      base.saved = true;
      base.legendaryResistance = "spent: the failed save becomes a success";
    }
  }
  if (condition && !saved && !autoHit && !base.dead && !base.encounterOver) {
    const fresh = resolveEnemyRef(encounter.id, enemy.id);
    if (fresh && fresh.status === "alive" && !fresh.conditions.includes(condition)) {
      const meta: ConditionMeta = conditionRounds
        ? { rounds: conditionRounds }
        : { saveEnds: { ability, dc } };
      patchEnemyConditions(fresh.id, [...fresh.conditions, condition], {
        ...fresh.conditionMeta,
        [condition]: meta,
      });
      publishEncounter(campaign.id);
      base.conditionApplied = condition;
      const summary = conditionEffectsFor(condition)?.summary;
      if (summary) {
        base.conditionEffect = summary;
      }
      base.duration = conditionRounds
        ? `${conditionRounds} round${conditionRounds === 1 ? "" : "s"}`
        : `until it succeeds on a ${ability.toUpperCase()} save (DC ${dc}) at the end of a round`;
    }
  }
  if (saved && condition) {
    base.note = `${enemy.displayName} resists: no ${condition}.`;
  }
  if (mech?.note) {
    base.spellNote = mech.note;
  }
  return { ok: true, ...base };
}


// Sleep: no saving throw. The caster rolls a pool of hit points, and a
// creature whose hit points the pool covers falls asleep; one with more is
// untouched. Undead and creatures that cannot be charmed are not affected
// (SRD 5.1, Sleep). One call is one creature, the lowest first being the
// caller's to pick.
function sleepPool(
  campaign: Campaign,
  encounterId: string,
  enemy: EncounterEnemy,
  spell: string,
  pool: NonNullable<SpellMech["hitPointPool"]>,
  input: { spellLevel: number; slotLevel: number; caster: string; condition: string; note?: string },
): Record<string, unknown> {
  const dice = addDice(pool.dice, pool.perSlotLevel, Math.max(0, input.slotLevel - input.spellLevel));
  const rolled = rollExpression(dice).total;
  const base: Record<string, unknown> = {
    ok: true,
    spell,
    caster: input.caster,
    target: enemy.displayName,
    noSave: true,
    pool: `${dice}: ${rolled} hit points`,
    ...(input.note ? { spellNote: input.note } : {}),
  };
  const type = (enemy.stats.type ?? "").toLowerCase();
  if (type.includes("undead") || enemy.stats.conditionImmune.toLowerCase().includes("charmed")) {
    return { ...base, note: `${enemy.displayName} cannot be put to sleep by magic; nothing happens.` };
  }
  if (enemy.currentHp > rolled) {
    return {
      ...base,
      note: `${enemy.displayName} has ${enemy.currentHp} hit points, more than the ${rolled} the spell rolled: it stays awake.`,
    };
  }
  const fresh = resolveEnemyRef(encounterId, enemy.id);
  if (fresh && fresh.status === "alive" && !fresh.conditions.includes(input.condition)) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, input.condition], {
      ...fresh.conditionMeta,
      [input.condition]: { rounds: pool.rounds },
    });
    publishEncounter(campaign.id);
  }
  return {
    ...base,
    conditionApplied: input.condition,
    duration: `${pool.rounds} rounds, or until it takes damage or is shaken awake`,
  };
}

// ---- cast_buff ----

export const castBuffTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_buff",
    description:
      "A player casts a spell that grants an ongoing effect to themselves or allies (Bless, Mage Armor, Haste, Shield of Faith, Guidance, Hunter's Mark, Invisibility...). The server spends the slot, applies the effect as a tracked condition with its real mechanics (AC, attack/save dice, resistances, speed) and duration, and handles concentration. Call this INSTEAD of narrating a buff or using set_condition for one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId of the caster from GAME STATE." },
        spell: { type: "string", description: "Exact spell name from the caster's list." },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend. Omit for cantrips.",
        },
        targetCharacterIds: {
          type: "array",
          items: { type: "string" },
          description: "Who receives the effect (characterIds). Defaults to the caster.",
        },
        variant: {
          type: "string",
          description: "For spells with a choice (Enlarge/Reduce): the chosen effect.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "spell"],
    },
  },
};

const castBuffSchema = z.object({
  characterId: z.string(),
  spell: z.string().max(80),
  level: z.coerce.number().int().min(1).max(9).optional(),
  targetCharacterIds: z.array(z.string()).max(6).optional(),
  variant: z.string().max(40).optional(),
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
  const authors = spellAuthorsFor(campaign);
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userIds: authors });
  if (!resolvedMech) {
    return {
      error: `No content pack knows "${args.spell}". If it grants an effect, apply it with set_condition (with rounds) after spending the slot with use_spell_slot.`,
    };
  }
  const redirect = castRedirect(resolvedMech, "buff");
  if (redirect) {
    return { error: redirect };
  }
  const buff = resolvedMech.mech.buff;
  if (!buff) {
    return {
      error: `${resolvedMech.name} carries no enforceable effect; spend the slot with use_spell_slot and narrate it.`,
    };
  }

  // The condition applied: the spell's own, or a declared variant.
  const wantedVariant = (args.variant ?? "").trim().toLowerCase();
  const condition =
    wantedVariant && buff.variants?.some((entry) => entry.toLowerCase().includes(wantedVariant))
      ? buff.variants.find((entry) => entry.toLowerCase().includes(wantedVariant))!
      : buff.condition;

  // Polymorph: the variant names the beast form and the server applies its
  // whole stat block as a transformation (the wildShape machinery: beast HP
  // pool, stat override, natural attacks). Resolved before the slot spends.
  const polymorphForm = condition === "polymorphed" ? findBeastForm(args.variant ?? "") : null;
  if (condition === "polymorphed" && !polymorphForm) {
    return {
      error: `Polymorph needs a beast form the table knows: pass variant (e.g. 'giant ape', 'brown bear', 'tyrannosaurus rex').`,
    };
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
  // slot level above 1st; a single-target buff one.
  const plannedSlot = resolvedMech.spellLevel >= 1 ? Math.max(resolvedMech.spellLevel, args.level ?? 0) : null;
  const most =
    buff.target === "ally" || buff.target === "self"
      ? 1
      : resolvedMech.mech.targets
        ? castShares(resolvedMech.mech, {
            spellLevel: resolvedMech.spellLevel,
            slotLevel: plannedSlot,
            casterLevel: sheet.level,
          })
        : 6;
  if (targetSheets.length > most) {
    return {
      error: `${resolvedMech.name} from a level ${plannedSlot ?? resolvedMech.spellLevel} slot affects at most ${most} creature${most === 1 ? "" : "s"}; ${targetSheets.length} were named. Name ${most} or fewer, or cast it from a higher slot. Nothing was spent.`,
    };
  }
  // 5e: the new form's CR may not exceed the target's level.
  if (polymorphForm) {
    const tooLow = targetSheets.find((target) => polymorphForm.cr > target.level);
    if (tooLow) {
      return {
        error: `${polymorphForm.name} is CR ${formatCr(polymorphForm.cr)}, above ${tooLow.name}'s level ${tooLow.level}; Polymorph is limited to beasts of CR no higher than the target's level. Offer a lesser form.`,
      };
    }
  }
  // On a mapped fight each recipient must be within the spell's range with
  // a clear path: a touch spell reaches only the creature beside the caster.
  const facts = spellFactsFor(args.spell, authors);
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    for (const target of targetSheets) {
      const reach = spellReachProblem({
        encounterId: encounter.id,
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
  // the slot of the spell's own level when none is named, the turn, the
  // material and concentration (a second concentration spell ends the
  // first and its effects). A refused cast refuses the buff.
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

  // The spell's own duration. Rounds tick in a fight and on the clock
  // outside one (src/lib/dm/condition-tick.ts), so Mage Armor's eight hours
  // are eight hours; set_condition takes the long ones as minutes or hours.
  const rounds = Math.max(1, buff.rounds);
  const duration =
    rounds <= 100
      ? { rounds }
      : rounds % 600 === 0 && rounds / 600 <= 24
        ? { hours: rounds / 600 }
        : { minutes: Math.min(1440, Math.ceil(rounds / 10)) };
  const applied: string[] = [];
  for (const target of targetSheets) {
    const outcome = applyDmMutation(
      campaign,
      turn.id,
      "set_condition",
      JSON.stringify({
        characterId: target.id,
        condition,
        ...duration,
        reason: `${resolvedMech.name} cast by ${sheet.name}`,
      }),
      sheets,
      sheetsById,
    ).result;
    if (!("error" in outcome)) {
      applied.push(target.name);
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
            abilities: polymorphForm.abilities,
            speed: polymorphForm.speed,
            attacks: polymorphForm.attacks,
          },
        });
        if (shaped) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: shaped });
        }
      }
    }
    // Temporary hit points ride the cast (False Life, Heroism-likes); 5e
    // temp HP never stacks, the higher value stands.
    if (buff.tempHp) {
      const amount =
        buff.tempHp.base +
        (buff.tempHp.perSlotLevel ?? 0) * Math.max(0, (slotLevel ?? resolvedMech.spellLevel) - resolvedMech.spellLevel);
      const fresh = getSheetById(target.id);
      if (fresh && fresh.tempHp < amount) {
        applyDmMutation(
          campaign,
          turn.id,
          "update_sheet",
          JSON.stringify({
            characterId: target.id,
            tempHp: amount,
            reason: `${resolvedMech.name}: ${amount} temporary hit points`,
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

const castAtPlayerSchema = z.object({
  characterId: z.string(),
  source: z.string().max(80).optional(),
  saveAbility: z.preprocess(normalizeAbility, z.enum(["str", "dex", "con", "int", "wis", "cha"])),
  dc: z.coerce.number().int().min(1).max(30),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  rounds: z.coerce.number().int().min(1).max(100).optional(),
  casterEnemyId: z.string().optional(),
  spell: z.string().max(80).optional(),
  reason: z.string().optional(),
});

// Best-effort enemy concentration: when a tool call names the casting enemy
// and its spell, and the spell requires concentration, record it on the
// enemy row. Damage to that enemy forces the CON save and a break ends the
// spell's conditions (src/lib/dm/enemy-damage.ts). Replacing a previous
// concentration spell ends the old one's effects immediately, like a PC's.
export function trackEnemyConcentration(
  campaign: Campaign,
  casterEnemyId: string | undefined,
  spellName: string | undefined,
): string | null {
  const spell = (spellName ?? "").trim();
  if (!casterEnemyId || !spell) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter ? resolveEnemyRef(encounter.id, casterEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return null;
  }
  const resolved = spellMechanicsFor({ spell });
  if (!resolved?.concentration) {
    return null;
  }
  if (enemy.concentration && enemy.concentration.toLowerCase() !== resolved.name.toLowerCase()) {
    clearSpellConditionsByName(campaign, enemy.concentration);
  }
  setEnemyConcentration(enemy.id, resolved.name);
  return `${enemy.displayName} is now concentrating on ${resolved.name}; damage to it forces a CON save and a break ends the effect.`;
}

// The mirror of cast_at_enemy. Before this the model applied set_condition
// to a character with no save rolled at all, so a monster's Hold Person was
// simply decided rather than resisted.
export function handleCastAtPlayer(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof castAtPlayerSchema>;
  try {
    args = castAtPlayerSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: cast_at_player needs characterId, saveAbility, and dc.",
    };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is DEAD; nothing can affect them.` };
  }
  if (!args.damage && !args.condition) {
    return { error: "cast_at_player needs damage and/or condition; otherwise nothing happens." };
  }
  if (args.damage && !isValidExpression(args.damage)) {
    return { error: `Invalid damage expression "${args.damage}".` };
  }

  const source = (args.source ?? "the effect").trim() || "the effect";
  // The save a requested roll would be (src/lib/dm/forced-save.ts):
  // conditions, exhaustion, a nearby paladin's aura, the lasting effects on
  // saves, and a held Bardic Inspiration die, which the roll spends.
  const save = rollCharacterSave(
    campaign,
    turn,
    sheet,
    args.saveAbility as SaveAbility,
    args.dc,
    `${sheet.name}: ${args.saveAbility.toUpperCase()} save vs ${source}`,
  );
  const saved = save.success;
  const rolledTotal = save.total;
  const notes = save.notes;
  const base: Record<string, unknown> = {
    ok: true,
    target: sheet.name,
    source,
    dc: args.dc,
    ...(rolledTotal === null ? { autoFailed: true } : { save: rolledTotal }),
    saved,
    ...(notes.length ? { conditionEffects: notes } : {}),
  };

  if (args.damage) {
    const outcome = rollExpression(args.damage);
    const dealt = saved ? (args.halfOnSave ? Math.floor(outcome.total / 2) : 0) : outcome.total;
    if (dealt > 0) {
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: sheet.id,
          amount: dealt,
          type: args.damageType,
          reason: `${source} (${args.saveAbility.toUpperCase()} save ${saved ? "succeeded" : "failed"})`,
        }),
        sheets,
        sheetsById,
      ).result;
      Object.assign(base, { damage: dealt, ...applied });
    } else {
      base.damage = 0;
    }
  }

  // The effect on the board: a beam from the caster when an enemy cast it,
  // a burst alone otherwise (a trap, a hazard, an unseen caster).
  {
    const to = tokenPosition(campaign.id, sheet.id);
    if (to) {
      const from = args.casterEnemyId ? tokenPosition(campaign.id, args.casterEnemyId) : null;
      if (from && !from.hidden) {
        recordEncounterTarget(
          getActiveEncounter(campaign.id)?.id ?? "",
          getActiveEncounter(campaign.id)?.round ?? 0,
          args.casterEnemyId ?? "",
          sheet.id,
        );
      }
      publishFx(
        campaign.id,
        planSpellFx({
          ...(from && !from.hidden ? { from: from.at, fromTokenId: from.tokenId } : {}),
          to: to.at,
          toTokenId: to.tokenId,
          resolution: "save",
          saved,
          halfOnSave: Boolean(args.halfOnSave),
          ...(typeof base.damage === "number" && base.damage > 0 ? { damage: base.damage } : {}),
          ...(args.damageType ? { damageType: args.damageType } : {}),
        }),
      );
    }
  }

  if (args.condition && !saved) {
    const condition = canonicalCondition(args.condition);
    const applied = applyDmMutation(
      campaign,
      turn.id,
      "set_condition",
      JSON.stringify({
        characterId: sheet.id,
        condition,
        ...(args.rounds
          ? { rounds: args.rounds }
          : { saveAbility: args.saveAbility, saveDc: args.dc }),
        reason: source,
      }),
      sheets,
      sheetsById,
    ).result;
    if (!("error" in applied)) {
      base.conditionApplied = condition;
      base.duration = args.rounds
        ? `${args.rounds} round${args.rounds === 1 ? "" : "s"}`
        : `until they succeed on a ${args.saveAbility.toUpperCase()} save (DC ${args.dc}) at the end of a round`;
    }
  }
  if (saved && args.condition) {
    base.note = `${sheet.name} shakes it off: no ${args.condition}.`;
  }
  // A concentration spell cast by a named enemy is tracked even when the
  // save succeeded (Hold Person holds nobody yet the hag still concentrates).
  const tracked = trackEnemyConcentration(campaign, args.casterEnemyId, args.spell);
  if (tracked) {
    base.enemyConcentration = tracked;
  }
  return base;
}
