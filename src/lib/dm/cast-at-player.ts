import { canAct } from "@/lib/dm/can-act";
import { castFromFoeSheet } from "@/lib/dm/sheet-foe-cast";
import { hasDungeonDelver, shieldMasterSaveBonus, spellSaveAdvantageReach } from "@/lib/srd/feat-combat";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { z } from "zod";
import { castToNoEffect, spellWardOn } from "@/lib/dm/cast-reach";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, recordEncounterTarget, setEnemyConcentration } from "@/lib/db/encounters";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { isValidExpression } from "@/lib/dice";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import { planSpellFx } from "@/lib/battlemap/fx-plan";
import { clearSpellConditionsByName, concentrationRoundsFor } from "@/lib/dm/concentration";
import { durationArgsFor, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { normalizeAbility } from "@/lib/dm/arg-coerce";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { prepareEnemyUse, type EnemyUse } from "@/lib/dm/enemy-casting";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { rollCard } from "@/lib/dm/action-common";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { applyDmMutation, canonicalCondition } from "@/lib/dm/mutations";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { saveDamageTaken } from "@/lib/srd/trait-rules";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { sanctuaryRefusal } from "@/lib/dm/spell-defenses";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { outOfReach } from "@/lib/dm/spell-planes";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { saveAgainst } from "@/lib/dm/roll-about";

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
  // An enemy, or a character fighting on the other side (issue 503), who
  // casts from their own sheet.
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
  const resolved = spellMechanicsFor({ spell, userIds: spellAuthorsFor(campaign) });
  if (!resolved?.concentration) {
    return null;
  }
  if (enemy.concentration && textKey(enemy.concentration) !== textKey(resolved.name)) {
    clearSpellConditionsByName(campaign, enemy.concentration, undefined, enemy.id);
  }
  setEnemyConcentration(enemy.id, resolved.name, concentrationRoundsFor(resolved.name));
  return `${enemy.displayName} is now concentrating on ${resolved.name}; damage to it forces a CON save and a break ends the effect.`;
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
    // The whole of what the spell lays, as a character's spell lays it on a
    // monster: Hypnotic Pattern's charmed creature is incapacitated too.
    const spellEffect = spellConditionMeta(
      use.spellCondition,
      { spell: use.name, casterId: use.enemy.id, slotLevel: use.slotLevel },
      { ability: save.ability, dc: save.dc },
    );
    const first = handleSetCondition(campaign, turn.id, fresh, { condition }, reason, { spellEffect });
    const also = (use.spellCondition.also ?? []).filter((name) => name.toLowerCase() !== condition.toLowerCase());
    const landed = also.filter((name) => !("error" in handleSetCondition(campaign, turn.id, getSheetById(sheet.id) ?? fresh, { condition: name }, reason, { spellEffect })));
    return landed.length && !("error" in first) ? { ...first, alsoApplied: landed } : first;
  }
  // The block's own words for how long it lasts (monster-abilities.ts): a
  // count, a repeat save, a long rest, or a cure. Only a condition the block
  // gives no word for at all falls back to a save each turn, so it cannot
  // last forever by omission.
  const lasting = Boolean(use?.untilLongRest || use?.lasting);
  if (use?.untilLongRest) {
    return handleSetCondition(campaign, turn.id, fresh, { condition, sourceEnemyId: use.enemy.id }, reason, {
      spellEffect: { source: use.enemy.id, untilLongRest: true },
    });
  }
  const applied = applyDmMutation(
    campaign,
    turn.id,
    "set_condition",
    JSON.stringify({
      characterId: sheet.id,
      condition,
      ...(timing.rounds ? durationArgsFor(timing.rounds) : {}),
      ...(timing.saveEnds || (!timing.rounds && !lasting) ? { saveAbility: save.ability, saveDc: save.dc } : {}),
      ...(use ? { sourceEnemyId: use.enemy.id } : {}),
      reason,
    }),
    sheets,
    sheetsById,
  ).result;
  // "Falls unconscious for 10 minutes or until it takes damage": the first
  // damage ends it (src/lib/dm/spell-effects.ts reads the flag). The sleep
  // when the use lays one ("poisoned and unconscious ... wakes if it takes
  // damage"), else its condition. Marked on the instance this enemy laid,
  // after the condition went on the ordinary way, so a sleep that is not
  // magic stays one Fey Ancestry does not turn.
  const laid = [use?.condition, ...(use?.also ?? [])];
  const wakes = condition === "unconscious" || (condition === use?.condition && !laid.includes("unconscious"));
  if (use?.endsOnDamage && wakes && !("error" in applied)) {
    const now = getSheetById(sheet.id);
    const meta = { ...((now?.conditionMeta ?? {}) as ConditionMetaMap) };
    const key = Object.keys(meta).find((name) => name.toLowerCase() === condition.toLowerCase());
    if (now && key) {
      const entry = meta[key];
      meta[key] = entry.source === use.enemy.id || !entry.others?.length
        ? { ...entry, endsOnDamage: true }
        : { ...entry, others: entry.others.map((other) => (other.source === use.enemy.id ? { ...other, endsOnDamage: true } : other)) };
      patchSheet(sheet.id, { conditionMeta: meta });
    }
  }
  return applied;
}

// The rest of what a failed save of an enemy's ability lays, after its first
// condition (src/lib/dm/save-effect.ts): the conditions listed with it
// ("blinded and deafened"), and the one a failure by a margin adds ("If the
// saving throw fails by 5 or more, the target is also frightened"). `total`
// is the save rolled, null for one failed without a roll, which no margin
// is read from. Returns the conditions that landed.
export function layFailedSaveExtras(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  use: EnemyUse,
  save: { ability: SaveAbility; dc: number; total: number | null },
  timing: { rounds?: number; saveEnds: boolean },
  reason: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string[] {
  const margin = use.failBy && save.total !== null && save.dc - save.total >= use.failBy.margin ? [use.failBy.condition] : [];
  const landed: string[] = [];
  for (const name of [...(use.also ?? []), ...margin]) {
    const standing = getSheetById(sheet.id);
    if (!standing || standing.currentHp <= 0) {
      break;
    }
    const condition = canonicalCondition(name);
    const applied = layEnemyCondition(campaign, turn, standing, use, condition, save, timing, reason, sheets, sheetsById);
    if (!("error" in applied)) {
      landed.push(condition);
    }
  }
  return landed;
}

export function handleCastAtPlayer(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: z.infer<typeof castAtPlayerSchema>;
  try {
    args = castAtPlayerSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return {
      error: "Invalid arguments: cast_at_player needs characterId, saveAbility, and dc.",
      retry: true,
    };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // casterEnemyId naming a character on the other side: their own cast,
  // from their sheet (sheet-foe-cast.ts, issue 503).
  const fromSheet = castFromFoeSheet(campaign, turn, sheet.id, args, sheets, sheetsById);
  if (fromSheet) {
    return fromSheet;
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is DEAD; nothing can affect them. The enemy may target someone else or take another action.`, retry: true };
  }
  // Blink, Etherealness, Maze took them off the Material Plane (spell-planes.ts).
  const away = args.casterEnemyId ? outOfReach(sheet) : null;
  // The enemy is the DM's to play: a target it cannot reach is another action
  // to pick, not a refusal to narrate.
  if (away) {
    return { error: `${away.error} Nothing was spent.`, retry: true };
  }

  // An enemy caster acts through the enemy guard and its own block: its
  // action (or a legendary action bought for it), the ability's printed save,
  // DC and dice, its recharge, its spell list and slots.
  let use: EnemyUse | null = null;
  let ward: string | null = null;
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
      return warded;
    }
    // A Globe of Invulnerability or an Antimagic Field around the target: the
    // spell is cast, its use spent, and does nothing to them (zone-rules.ts).
    ward = spellWardOn({ encounterId: prepared.enemy.encounterId, casterId: prepared.enemy.id, targetId: sheet.id, targetName: sheet.name, facts: args.spell ? spellFactsFor(args.spell, spellAuthorsFor(campaign)) : null });
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
      retry: true,
    };
  }
  if (damage && !isValidExpression(damage)) {
    return { error: `Invalid damage expression "${damage}".`, retry: true };
  }
  use?.commit();
  if (ward) {
    return { ok: true, target: sheet.name, source: use ? `${use.enemy.displayName}'s ${use.name}` : args.spell, ...castToNoEffect(ward) };
  }

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
        markReactionUsed(live, sheet.id);
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
    const disintegrates = Boolean((use?.spell ?? args.spell) && spellMechanicsFor({ spell: use?.spell ?? args.spell ?? "", userIds: spellAuthorsFor(campaign) })?.mech.riders?.disintegrates);
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
    const extras = use?.fromBlock ? layFailedSaveExtras(campaign, turn, sheet, use, { ability, dc, total: save.total }, { rounds, saveEnds }, source, sheets, sheetsById) : [];
    if (!("error" in applied)) {
      base.conditionApplied = [condition, ...(Array.isArray(applied.alsoApplied) ? applied.alsoApplied : []), ...extras].join(", ");
      base.duration = rounds
        ? `${rounds} round${rounds === 1 ? "" : "s"}${saveEnds ? `, or until a successful ${ability.toUpperCase()} save (DC ${dc}) at the end of one of their turns` : ""}`
        : `until they succeed on a ${ability.toUpperCase()} save (DC ${dc}) at the end of one of their turns`;
    }
  }
  // A failure by a margin with no first condition (a breath that also
  // frightens on a failure by 5): only the margin's condition.
  if (!conditionName && !saved && use?.fromBlock && use.failBy) {
    const extras = layFailedSaveExtras(campaign, turn, sheet, use, { ability, dc, total: save.total }, { rounds, saveEnds }, source, sheets, sheetsById);
    if (extras.length) {
      base.conditionApplied = extras.join(", ");
    }
  }
  if (saved && conditionName) {
    base.note = `${sheet.name} shakes it off: no ${conditionName}.`;
  }
  // The second save the same use forces (src/lib/dm/ability-entries.ts).
  if (use?.followUp) {
    base.next = `${use.name} also forces a second save on the creatures its text names: resolve it with cast_at_player or aoe_damage, casterEnemyId ${use.enemy.id} and ability "${use.followUp}".`;
  }
  // A concentration spell cast by a named enemy is tracked even when the
  // save succeeded (Hold Person holds nobody yet the hag still concentrates).
  const tracked = trackEnemyConcentration(campaign, args.casterEnemyId, use?.spell ?? args.spell);
  if (tracked) {
    base.enemyConcentration = tracked;
  }
  return base;
}
