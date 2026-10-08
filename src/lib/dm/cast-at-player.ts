import { canAct } from "@/lib/dm/can-act";
import { hasDungeonDelver, shieldMasterSaveBonus, spellSaveAdvantageReach } from "@/lib/srd/feat-combat";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { z } from "zod";
import { globeProblemFor } from "@/lib/dm/zone-rules";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, recordEncounterTarget, saveEncounter, setEnemyConcentration } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression } from "@/lib/dice";
import { spellMechanicsFor } from "@/lib/content";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { planSpellFx } from "@/lib/battlemap/fx-plan";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { prepareEnemyUse, type EnemyUse } from "@/lib/dm/enemy-casting";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { rollCard } from "@/lib/dm/action-common";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { saveDamageTaken } from "@/lib/srd/trait-rules";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { sanctuaryRefusal } from "@/lib/dm/spell-defenses";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { outOfReach } from "@/lib/dm/spell-planes";

// cast_at_player: a save forced on ONE character, by an enemy's spell or
// ability or by a hazard (SRD 5.1, Saving Throws). The mirror of
// cast_at_enemy. The character's save is their full save (conditions,
// auras, Brave, Evasion); an enemy caster is held to the enemy action guard
// and to its own block's numbers (src/lib/dm/enemy-casting.ts). Only an
// effect with no creature behind it (a trap, a curse) takes the caller's
// numbers. Split from cast-tools.ts, which re-exports it.

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
  ability: z.string().max(80).optional(),
  spell: z.string().max(80).optional(),
  reason: z.string().optional(),
  // Set by apply_hazard for a trap: Dungeon Delver saves at advantage and
  // takes half (src/lib/srd/feat-combat.ts).
  hazard: z.enum(["trap"]).optional(),
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
    clearSpellConditionsByName(campaign, enemy.concentration, undefined, enemy.id);
  }
  setEnemyConcentration(enemy.id, resolved.name);
  return `${enemy.displayName} is now concentrating on ${resolved.name}; damage to it forces a CON save and a break ends the effect.`;
}

// What the save is against, for the traits keyed to it: Brave against fear,
// a dwarf against poison, Gnome Cunning against magic.
// `spellBy` is the creature type of a spell's caster, for Holy Nimbus
// (advantage against spells cast by fiends or undead).
export function saveAgainst(parts: { condition?: string; damageType?: string; magical?: boolean; spellBy?: string }): string | undefined {
  const words = [
    parts.condition,
    parts.damageType,
    parts.magical ? "spell magic" : "",
    parts.spellBy ? `spell cast by ${parts.spellBy}` : "",
  ].filter(Boolean);
  return words.length ? words.join(" ") : undefined;
}

// What an enemy's effect lays on a character who failed the save: tied to
// the enemy (so it ends when the enemy falls), and, for a spell, recording
// the spell and caster so the enemy's broken concentration ends it
// (src/lib/dm/spell-effects.ts). A repeatable save re-rolls each round.
export function layEnemyCondition(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  use: EnemyUse | null,
  condition: string,
  save: { ability: SaveAbility; dc: number },
  timing: { rounds?: number; saveEnds: boolean },
  reason: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const fresh = getSheetById(sheet.id) ?? sheet;
  if (use?.spellCondition) {
    return handleSetCondition(campaign, turn.id, fresh, { condition }, reason, {
      spellEffect: spellConditionMeta(
        use.spellCondition,
        { spell: use.name, casterId: use.enemy.id, slotLevel: use.slotLevel },
        { ability: save.ability, dc: save.dc },
      ),
    });
  }
  return applyDmMutation(
    campaign,
    turn.id,
    "set_condition",
    JSON.stringify({
      characterId: sheet.id,
      condition,
      ...(timing.rounds ? { rounds: timing.rounds } : {}),
      ...(timing.saveEnds || !timing.rounds ? { saveAbility: save.ability, saveDc: save.dc } : {}),
      ...(use ? { sourceEnemyId: use.enemy.id } : {}),
      reason,
    }),
    sheets,
    sheetsById,
  ).result;
}

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
  // Blink, Etherealness, Maze took them off the Material Plane (spell-planes.ts).
  const away = args.casterEnemyId ? outOfReach(sheet) : null;
  if (away) {
    return { error: `${away} Nothing was spent.` };
  }

  // An enemy caster acts through the enemy guard and its own block: its
  // action (or a legendary action bought for it), the ability's printed save,
  // DC and dice, its recharge, its spell list and slots.
  let use: EnemyUse | null = null;
  if (args.casterEnemyId) {
    const prepared = prepareEnemyUse(campaign, {
      casterEnemyId: args.casterEnemyId,
      ability: args.ability,
      spell: args.spell,
      source: args.source,
      targetIds: [sheet.id],
      sent: { save: args.saveAbility, dc: args.dc, damage: args.damage },
    });
    if ("error" in prepared) {
      return prepared;
    }
    // Sanctuary answers a harmful spell as it answers an attack; the refused
    // caster keeps its action for another target.
    const warded = sanctuaryWard(campaign.id, prepared.enemy, sheet, sanctuaryRefusal);
    if (warded) {
      return { error: warded };
    }
    // A Globe of Invulnerability around the target turns the spell (zone-rules.ts).
    const globed = globeProblemFor(prepared.enemy.encounterId, prepared.enemy.id, sheet.id, sheet.name, args.spell);
    if (globed) {
      return { error: globed };
    }
    use = prepared;
  }
  const byBlock = Boolean(use?.fromBlock);
  const ability = (use?.save ?? args.saveAbility) as SaveAbility;
  const dc = use?.dc ?? args.dc;
  const damage = byBlock ? use?.damage : args.damage;
  const damageType = (byBlock ? use?.damageType : undefined) ?? args.damageType;
  const halfOnSave = byBlock ? Boolean(use?.halfOnSave) : Boolean(args.halfOnSave);
  const conditionName = byBlock ? use?.condition : args.condition;
  const rounds = byBlock ? use?.rounds : args.rounds;
  const saveEnds = byBlock ? Boolean(use?.saveEnds) : !args.rounds;
  if (!damage && !conditionName) {
    return {
      error: use?.fromBlock
        ? `${use.name} forces no save with damage or a condition on ${use.enemy.displayName}'s block; narrate what it does, or use its attacks.`
        : "cast_at_player needs damage and/or condition; otherwise nothing happens.",
    };
  }
  if (damage && !isValidExpression(damage)) {
    return { error: `Invalid damage expression "${damage}".` };
  }
  use?.commit();

  const source = (args.source ?? (use ? `${use.enemy.displayName}'s ${use.name}` : "the effect")).trim() || "the effect";
  // The save a requested roll would be (src/lib/dm/forced-save.ts):
  // conditions, exhaustion, a nearby paladin's aura, the lasting effects on
  // saves, the traits keyed to what it resists, and a held Bardic
  // Inspiration die, which the roll spends.
  const base0: Record<string, unknown> = {};
  // Mage Slayer: advantage on the save against a spell cast by a creature
  // within 5 feet. Dungeon Delver: advantage against a trap.
  // Off the battle map the distance is the fiction's; a melee character
  // is read as beside the caster, as the attack engine reads reach.
  // Spellbreaker's magic resistance reaches 30 feet the same way.
  const reach = spellSaveAdvantageReach(sheet);
  const nearCaster =
    use?.enemy && (use.spell || args.spell) && reach
      ? (tilesBetween(use.enemy.encounterId, sheet.id, use.enemy.id) ?? 1) <= reach.tiles
      : false;
  const trapWard = args.hazard === "trap" && hasDungeonDelver(sheet);
  const claim = nearCaster && reach
    ? { advantage: "advantage" as const, reason: `${reach.feat}: the caster is within ${reach.tiles * 5} feet` }
    : trapWard
      ? { advantage: "advantage" as const, reason: "Dungeon Delver: a trap" }
      : null;
  const save = rollCharacterSave(
    campaign,
    turn,
    sheet,
    ability,
    dc,
    `${sheet.name}: ${ability.toUpperCase()} save vs ${source}`,
    saveAgainst({
      condition: conditionName,
      damageType,
      magical: use?.magical || Boolean(args.spell),
      spellBy: args.spell ? use?.enemy.stats.type : undefined,
    }),
    use?.enemy ?? null,
    claim,
    // A spell cast at them alone: Shield Master's shield on a Dexterity save.
    true,
  );
  if (claim) {
    base0.featAdvantage = claim.reason;
  }
  const saved = save.success;
  const base: Record<string, unknown> = {
    ...base0,
    ok: true,
    target: sheet.name,
    source,
    saveAbility: ability,
    dc,
    ...(save.total === null ? { autoFailed: true } : { save: save.total }),
    saved,
    ...(save.notes.length ? { conditionEffects: save.notes } : {}),
    ...(use?.corrections.length ? { corrected: use.corrections } : {}),
  };

  if (damage) {
    // The card shows the dice as rolled; the save halves or stops what lands.
    const caster: RollAttacker | null = use ? { kind: "enemy", id: use.enemy.id, name: use.enemy.displayName } : null;
    const outcome = rollCard(campaign, turn, sheet.id, "damage", rollAgainst(use?.name || args.spell || args.source || "Effect", sheet.name), damage, caster);
    // The one save-for-half rule every path shares, Evasion included
    // (src/lib/srd/trait-rules.ts).
    const taken = saveDamageTaken({ total: outcome.total, saved, halfOnSave, ability, sheet });
    let dealt = taken.damage;
    // Shield Master: a successful Dexterity save against an effect aimed at
    // them alone costs the reaction to take no damage at all.
    if (saved && dealt > 0 && ability === "dex" && shieldMasterSaveBonus(sheet) > 0) {
      const live = getActiveEncounter(campaign.id);
      if (live && !live.reactionsUsed.includes(sheet.id) && canAct({ sheet, encounter: live, kind: "reaction" }).ok) {
        live.reactionsUsed = [...live.reactionsUsed, sheet.id];
        saveEncounter(live);
        dealt = 0;
        base.shieldMaster = `Shield Master: the reaction turns the successful save into no damage at all; ${sheet.name}'s reaction is used until their next turn.`;
      }
    }
    // Dungeon Delver: resistance to the damage dealt by traps.
    if (trapWard && dealt > 0) {
      dealt = Math.floor(dealt / 2);
      base.dungeonDelver = "Dungeon Delver: resistance to trap damage, halved.";
    }
    if (taken.evasion) {
      base.evasion = taken.evasion;
    }
    // Disintegrate: a character it drops to 0 is dust, not dying.
    const disintegrates = Boolean((use?.spell ?? args.spell) && spellMechanicsFor({ spell: use?.spell ?? args.spell ?? "" })?.mech.riders?.disintegrates);
    if (dealt > 0) {
      const reason = `${source} (${ability.toUpperCase()} save ${saved ? "succeeded" : "failed"})`;
      const applied = disintegrates
        ? applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount: dealt, type: damageType, magical: true, disintegrate: true, reason })
        : applyDmMutation(
            campaign,
            turn.id,
            "apply_damage",
            JSON.stringify({
              characterId: sheet.id,
              amount: dealt,
              type: damageType,
              ...(use?.magical ? { magical: true } : {}),
              ...((use?.spell ?? args.spell) ? { spell: use?.spell ?? args.spell } : {}),
              reason,
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
      const casterId = use?.enemy.id ?? args.casterEnemyId;
      const from = casterId ? tokenPosition(campaign.id, casterId) : null;
      if (from && !from.hidden) {
        const encounter = getActiveEncounter(campaign.id);
        recordEncounterTarget(encounter?.id ?? "", encounter?.round ?? 0, casterId ?? "", sheet.id);
      }
      publishFx(
        campaign.id,
        planSpellFx({
          ...(from && !from.hidden ? { from: from.at, fromTokenId: from.tokenId } : {}),
          to: to.at,
          toTokenId: to.tokenId,
          resolution: "save",
          saved,
          halfOnSave,
          ...(typeof base.damage === "number" && base.damage > 0 ? { damage: base.damage } : {}),
          ...(damageType ? { damageType } : {}),
        }),
      );
    }
  }

  const standing = getSheetById(sheet.id);
  if (conditionName && !saved && standing && standing.currentHp > 0) {
    const condition = canonicalCondition(conditionName);
    const applied = layEnemyCondition(
      campaign,
      turn,
      sheet,
      use,
      condition,
      { ability, dc },
      { rounds, saveEnds },
      source,
      sheets,
      sheetsById,
    );
    if (!("error" in applied)) {
      base.conditionApplied = condition;
      base.duration = rounds
        ? `${rounds} round${rounds === 1 ? "" : "s"}${saveEnds ? `, or until a successful ${ability.toUpperCase()} save (DC ${dc}) at the end of a round` : ""}`
        : `until they succeed on a ${ability.toUpperCase()} save (DC ${dc}) at the end of a round`;
    }
  }
  if (saved && conditionName) {
    base.note = `${sheet.name} shakes it off: no ${conditionName}.`;
  }
  // A concentration spell cast by a named enemy is tracked even when the
  // save succeeded (Hold Person holds nobody yet the hag still concentrates).
  const tracked = trackEnemyConcentration(campaign, args.casterEnemyId, use?.spell ?? args.spell);
  if (tracked) {
    base.enemyConcentration = tracked;
  }
  return base;
}
