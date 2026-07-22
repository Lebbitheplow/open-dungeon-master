import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, patchEnemyConditions, setEnemyConcentration } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, isValidExpression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellMechanicsFor, type ResolvedSpellMech } from "@/lib/content";
import { allySaveAura } from "@/lib/dm/aura";
import { findBeastForm, formatCr } from "@/lib/srd/beast-forms";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { clearSpellConditionsByName, setConcentration } from "@/lib/dm/concentration";
import { saveModFor, type SaveAbility } from "@/lib/bestiary/statblock";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveRollExpression, resolveSheetRef } from "@/lib/dm/rolls";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import type { ConditionMeta } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
      return `${name} heals; spend the slot with use_spell_slot and apply it with heal (the server rolls the dice).`;
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
  // arguments are corrected rather than trusted. Unknown (homebrew) spells
  // keep the model-supplied fallback.
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userId: sheet.userId });
  const redirect = castRedirect(resolvedMech, "save");
  if (redirect) {
    return { error: redirect };
  }
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
  const halfOnSave = mech ? Boolean(mech.halfOnSave) : Boolean(args.halfOnSave);
  if (mech && Boolean(args.halfOnSave) !== Boolean(mech.halfOnSave) && !autoHit) {
    corrections.push(
      mech.halfOnSave
        ? "A successful save halves the damage (the pack says so)."
        : "A successful save means no effect (the pack says so).",
    );
  }
  const damageType = mech?.damageType ?? args.damageType;
  // The content pack's own text decides the dice where it can, so upcasting
  // scales without the model having to remember how.
  const scaled = spellDamageFor({
    spell: args.spell,
    userId: sheet.userId,
    casterLevel: sheet.level,
    slotLevel: args.level,
  });
  const damageExpression = scaled?.dice ?? args.damage;
  if (!damageExpression && !args.condition && !mech?.condition) {
    return { error: "cast_at_enemy needs damage and/or condition; otherwise nothing happens." };
  }
  if (damageExpression && !isValidExpression(damageExpression)) {
    return { error: `Invalid damage expression "${damageExpression}".` };
  }
  // The pack's condition wins over the model's guess; its duration comes
  // with it (save-ends unless the pack states rounds).
  const mechCondition = mech?.condition ?? null;
  const condition = mechCondition
    ? canonicalCondition(mechCondition.name)
    : args.condition
      ? canonicalCondition(args.condition)
      : null;
  if (mechCondition && args.condition && canonicalCondition(args.condition) !== condition) {
    corrections.push(
      `${resolvedMech?.name} applies ${condition}, not ${args.condition}; the server used the real one.`,
    );
  }
  const conditionRounds = mechCondition
    ? (mechCondition.saveEnds ? undefined : mechCondition.rounds)
    : args.rounds;
  if (condition && enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return {
      error: `${enemy.displayName} is immune to ${condition} (immunities: ${enemy.stats.conditionImmune}); the spell cannot take hold. The slot was not spent.`,
    };
  }

  // Spend the slot first (spell-list validation and concentration come with
  // it); a refused spend refuses the cast.
  if (args.level) {
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({
        characterId: sheet.id,
        level: args.level,
        spell: args.spell,
        reason: (args.reason ?? "").slice(0, 200),
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
  } else {
    // Cantrip path: no slot, but the spell must still be on their list.
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    const onList = spellList.some(
      (entry) =>
        entry.toLowerCase().includes(args.spell.toLowerCase()) ||
        args.spell.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return { error: `${args.spell} is not on ${sheet.name}'s spell list; they cannot cast it.` };
    }
  }

  // The enemy's save, rolled from its real stat block as a visible card.
  // Auto-hit spells (Magic Missile) skip the save entirely.
  let saved = false;
  const base: Record<string, unknown> = {
    spell: resolvedMech?.name ?? args.spell,
    caster: sheet.name,
    target: enemy.displayName,
  };
  if (autoHit) {
    base.autoHit = true;
  } else {
    const saveOutcome = rollExpression(d20Expression(saveModFor(enemy.stats, ability)));
    const saveRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: `${enemy.displayName}: ${ability.toUpperCase()} save vs ${args.spell}`,
      dc,
      result: saveOutcome,
    });
    turn.rollIds.push(saveRoll.id);
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: saveRoll,
      source: "digital",
    });
    saved = saveOutcome.total >= dc;
    Object.assign(base, { save: saveOutcome.total, dc, saved });
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
  const resolvedMech = spellMechanicsFor({ spell: args.spell, userId: sheet.userId });
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

  // Spend the slot (spell-list validation and concentration come with it);
  // a refused spend refuses the cast. Cantrips validate the list only.
  const slotLevel = resolvedMech.spellLevel >= 1 ? (args.level ?? resolvedMech.spellLevel) : null;
  if (slotLevel) {
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({
        characterId: sheet.id,
        level: slotLevel,
        spell: args.spell,
        reason: (args.reason ?? "").slice(0, 200),
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
  } else {
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    const onList = spellList.some(
      (entry) =>
        entry.toLowerCase().includes(args.spell.toLowerCase()) ||
        args.spell.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return { error: `${args.spell} is not on ${sheet.name}'s spell list; they cannot cast it.` };
    }
    // Cantrip concentration effects (Guidance, True Strike) never touch a
    // slot, so concentration is set here instead.
    if (resolvedMech.concentration) {
      setConcentration(campaign, turn.id, sheet.id, resolvedMech.name);
    }
  }

  // Resolve the recipients: self-only spells ignore stray targets.
  const targetSheets: CharacterSheet[] = [];
  if (buff.target === "self" || !args.targetCharacterIds?.length) {
    targetSheets.push(sheet);
  } else {
    for (const ref of args.targetCharacterIds.slice(0, buff.target === "ally" ? 1 : 6)) {
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

  // Combat rounds only tick inside encounters, so long real-world durations
  // clamp to the meta's cap without losing anything at the table.
  const rounds = Math.max(1, Math.min(100, buff.rounds));
  // 5e: the new form's CR may not exceed the target's level.
  if (polymorphForm) {
    const tooLow = targetSheets.find((target) => polymorphForm.cr > target.level);
    if (tooLow) {
      return {
        error: `${polymorphForm.name} is CR ${formatCr(polymorphForm.cr)}, above ${tooLow.name}'s level ${tooLow.level}; Polymorph is limited to beasts of CR no higher than the target's level. Offer a lesser form.`,
      };
    }
  }
  const applied: string[] = [];
  for (const target of targetSheets) {
    const outcome = applyDmMutation(
      campaign,
      turn.id,
      "set_condition",
      JSON.stringify({
        characterId: target.id,
        condition,
        rounds,
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
    duration: `${rounds} round${rounds === 1 ? "" : "s"}`,
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
  // The save goes through the same roll engine as any other, so conditions,
  // exhaustion, a held Bardic Inspiration die, and a nearby paladin's aura
  // all apply.
  const aura = allySaveAura(campaign.id, sheet);
  const resolved = resolveRollExpression(
    { kind: "saving_throw", ability: args.saveAbility, dc: args.dc },
    sheet,
    aura ? { saveBonus: aura.bonus, saveNote: aura.note } : undefined,
  );
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  let saved: boolean;
  let rolledTotal: number | null = null;
  const notes: string[] = [];
  if ("autoFail" in resolved) {
    saved = false;
    notes.push(...resolved.notes);
  } else {
    const outcome = rollExpression(resolved.expression);
    rolledTotal = outcome.total;
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "saving_throw",
      detail: `${sheet.name}: ${args.saveAbility.toUpperCase()} save vs ${source}`,
      dc: args.dc,
      result: outcome,
    });
    turn.rollIds.push(roll.id);
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    saved = outcome.total >= args.dc;
    notes.push(...(resolved.conditionNotes ?? []));
  }

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
